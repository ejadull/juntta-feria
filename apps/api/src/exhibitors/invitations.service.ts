import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import {
  exhibitorInvitations,
  memberships,
  tenants,
  users,
} from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import type {
  AcceptInvitationInput,
  CreateInvitationInput,
} from './invitation.input.js';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface InvitationSummary {
  readonly id: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly name: string | null;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly createdAt: Date;
}

/** Returned once, at creation: the link is never stored nor shown again. */
export interface CreatedInvitation extends InvitationSummary {
  readonly url: string;
  readonly whatsappUrl: string;
}

export interface PublicInvitation {
  readonly organizationName: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly expiresAt: Date;
}

const NOT_FOUND = 'Invitation not found or no longer valid.';
const DAY_MS = 86_400_000;

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const view = {
  id: exhibitorInvitations.id,
  email: exhibitorInvitations.email,
  phone: exhibitorInvitations.phone,
  name: exhibitorInvitations.name,
  expiresAt: exhibitorInvitations.expiresAt,
  acceptedAt: exhibitorInvitations.acceptedAt,
  revokedAt: exhibitorInvitations.revokedAt,
  createdAt: exhibitorInvitations.createdAt,
};
type Row = {
  [K in keyof typeof view]: (typeof exhibitorInvitations.$inferSelect)[K];
};

function summarize(
  { revokedAt, ...row }: Row,
  now = new Date(),
): InvitationSummary {
  const status: InvitationStatus = row.acceptedAt
    ? 'ACCEPTED'
    : revokedAt
      ? 'REVOKED'
      : row.expiresAt <= now
        ? 'EXPIRED'
        : 'PENDING';
  return { ...row, status };
}

/**
 * Exhibitor invitations (EXH-04): a one-time link, shareable by WhatsApp, that lets a future
 * exhibitor create a confirmed account and an EXHIBITOR membership in the organization.
 */
@Injectable()
export class InvitationsService {
  /** ponytail: the web origin is the first configured CORS origin; add APP_PUBLIC_URL if they diverge. */
  private readonly webOrigin: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    this.webOrigin = env.corsOrigins.find((origin) => origin !== '*') ?? '';
  }

  create(
    tenantId: string,
    actorId: string,
    input: CreateInvitationInput,
  ): Promise<CreatedInvitation> {
    const token = randomBytes(32).toString('base64url');
    return this.database.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(exhibitorInvitations)
        .values({
          tokenHash: hashToken(token),
          email: input.email ?? null,
          phone: input.phone ?? null,
          name: input.name ?? null,
          createdBy: actorId,
          expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
        })
        .returning(view);
      await this.audit.record(tx, {
        actorId,
        action: 'invitation.created',
        entityType: 'exhibitor_invitation',
        entityId: row.id,
        after: {
          email: row.email,
          phone: row.phone,
          name: row.name,
          expiresAt: row.expiresAt,
        },
      });
      const url = `${this.webOrigin}/invitacion/${token}`;
      const organization = await this.organizationName(tx, tenantId);
      const text = `Hola${row.name ? ` ${row.name}` : ''}! ${organization} te invita a sumarte como feriante. Creá tu cuenta acá: ${url}`;
      const whatsappUrl = `https://wa.me/${row.phone ?? ''}?text=${encodeURIComponent(text)}`;
      return { ...summarize(row), url, whatsappUrl };
    });
  }

  list(tenantId: string): Promise<InvitationSummary[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select(view)
        .from(exhibitorInvitations)
        .orderBy(desc(exhibitorInvitations.createdAt));
      return rows.map((row) => summarize(row));
    });
  }

  /** Only a pending invitation can be revoked: an accepted one already created an account. */
  revoke(tenantId: string, actorId: string, id: string): Promise<void> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select(view)
        .from(exhibitorInvitations)
        .where(eq(exhibitorInvitations.id, id))
        .for('update');
      if (!row) throw new NotFoundException('Invitation not found.');
      if (row.acceptedAt || row.revokedAt)
        throw new ConflictException(
          'The invitation was already accepted or revoked.',
        );
      await tx
        .update(exhibitorInvitations)
        .set({ revokedAt: new Date() })
        .where(eq(exhibitorInvitations.id, id));
      await this.audit.record(tx, {
        actorId,
        action: 'invitation.revoked',
        entityType: 'exhibitor_invitation',
        entityId: id,
      });
    });
  }

  /** What the person holding the link sees before creating the account. */
  async show(token: string): Promise<PublicInvitation> {
    const target = await this.lookup(token);
    return this.database.withTenant(target.tenantId, async (tx) => {
      const row = await this.usable(tx, target.id);
      return {
        organizationName: await this.organizationName(tx, target.tenantId),
        email: row.email,
        name: row.name,
        expiresAt: row.expiresAt,
      };
    });
  }

  /**
   * Creates the account (confirmed: holding the link proves the invitation reached this person)
   * and the EXHIBITOR membership, and consumes the invitation, all in one transaction.
   */
  async accept(
    token: string,
    input: AcceptInvitationInput,
  ): Promise<{ user: { id: string; email: string }; tenantId: string }> {
    const target = await this.lookup(token);
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.database.withTenant(target.tenantId, async (tx) => {
        const invitation = await this.usable(tx, target.id, true);
        if (invitation.email && invitation.email !== input.email)
          throw new BadRequestException(
            'Invalid account: use the email the invitation was sent to.',
          );
        const now = new Date();
        const [user] = await tx
          .insert(users)
          .values({
            email: input.email,
            passwordHash,
            fullName: input.fullName,
            phone: input.phone ?? invitation.phone,
            confirmedAt: now,
          })
          .returning({ id: users.id, email: users.email });
        await tx
          .insert(memberships)
          .values({
            tenantId: target.tenantId,
            userId: user.id,
            role: 'EXHIBITOR',
          });
        await tx
          .update(exhibitorInvitations)
          .set({ acceptedAt: now, acceptedUserId: user.id })
          .where(eq(exhibitorInvitations.id, target.id));
        await this.audit.record(tx, {
          actorId: user.id,
          action: 'invitation.accepted',
          entityType: 'exhibitor_invitation',
          entityId: target.id,
          after: { userId: user.id, email: user.email },
        });
        return { user, tenantId: target.tenantId };
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          'An account with that email already exists; sign in instead.',
        );
      throw error;
    }
  }

  /** The only cross-tenant read (SECURITY DEFINER function, migration 0008). */
  private async lookup(
    token: string,
  ): Promise<{ id: string; tenantId: string }> {
    const { rows } = await this.database.db.execute<{
      id: string;
      tenant_id: string;
    }>(
      sql`SELECT id, tenant_id FROM exhibitor_invitation_lookup(${hashToken(token)})`,
    );
    if (!rows[0]) throw new NotFoundException(NOT_FOUND);
    return { id: rows[0].id, tenantId: rows[0].tenant_id };
  }

  /** Re-checks inside the transaction: the invitation may have been used or revoked meanwhile. */
  private async usable(
    tx: Transaction,
    id: string,
    forUpdate = false,
  ): Promise<Row> {
    const query = tx
      .select(view)
      .from(exhibitorInvitations)
      .where(eq(exhibitorInvitations.id, id));
    const [row] = await (forUpdate ? query.for('update') : query);
    if (!row || summarize(row).status !== 'PENDING')
      throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async organizationName(
    tx: Transaction,
    tenantId: string,
  ): Promise<string> {
    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return tenant?.name ?? '';
  }
}
