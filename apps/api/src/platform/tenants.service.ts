import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { hashPassword, passwordDisabled } from '../auth/password.js';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import { memberships, tenants, users } from '../db/schema.js';
import { fail } from '../reservations/reservations.service.js';
import { AuditService } from '../tenancy/audit.service.js';
import type { CreateTenantInput } from './tenant.input.js';

export interface CreatedTenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly owner: {
    readonly userId: string;
    readonly email: string;
    readonly created: boolean;
  };
}

export interface TenantSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly createdAt: Date;
}

const SLUG_CONSTRAINT = 'tenants_slug_unique';

const constraintOf = (error: unknown): string | undefined =>
  (error as { cause?: { constraint?: string } } | null)?.cause?.constraint;

/**
 * Organization onboarding by the platform administrator (CORE-04).
 *
 * `tenants`, `users` and `memberships` are global tables (no RLS, §2.2); only the audit row is
 * tenant-scoped. The whole operation runs in `withTenant(<new id>)`: the id is generated up front,
 * so `app.tenant_id` already points at the organization being born and the audit row lands in ITS
 * trail (the actor is the platform admin), all in the same transaction as the inserts.
 */
@Injectable()
export class TenantsService {
  private readonly passwordEnabled: boolean;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    this.passwordEnabled = env.auth.passwordEnabled;
  }

  async create(
    actorId: string,
    input: CreateTenantInput,
  ): Promise<CreatedTenant> {
    const tenantId = randomUUID();
    // Hash before the transaction: Argon2 is slow and must not hold a connection.
    if (input.owner.password && !this.passwordEnabled) throw passwordDisabled();
    const passwordHash = input.owner.password
      ? await hashPassword(input.owner.password)
      : null;
    try {
      return await this.database.withTenant(tenantId, async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({ id: tenantId, name: input.name, slug: input.slug })
          .returning({
            id: tenants.id,
            name: tenants.name,
            slug: tenants.slug,
          });
        const owner = await this.ensureOwner(tx, input.owner, passwordHash);
        await tx
          .insert(memberships)
          .values({ tenantId, userId: owner.userId, role: 'OWNER' });
        await this.audit.record(tx, {
          actorId,
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: tenantId,
          after: {
            name: tenant.name,
            slug: tenant.slug,
            ownerUserId: owner.userId,
          },
        });
        return { ...tenant, owner };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (constraintOf(error) === SLUG_CONSTRAINT)
          throw fail(
            ConflictException,
            'TENANT_SLUG_TAKEN',
            'That slug is already in use.',
          );
        // Two requests created the same new owner at once: the caller can safely retry.
        throw fail(
          ConflictException,
          'OWNER_CONFLICT',
          'The owner was just created; retry.',
        );
      }
      throw error;
    }
  }

  async list(): Promise<TenantSummary[]> {
    return this.database.db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt));
  }

  /** Reuses the account for that email (password untouched) or creates a confirmed one. */
  private async ensureOwner(
    tx: Transaction,
    owner: CreateTenantInput['owner'],
    passwordHash: string | null,
  ): Promise<CreatedTenant['owner']> {
    const [existing] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(sql`lower(${users.email}) = ${owner.email}`);
    if (existing)
      return { userId: existing.id, email: existing.email, created: false };
    const [user] = await tx
      .insert(users)
      .values({
        email: owner.email,
        passwordHash,
        fullName: owner.fullName,
        confirmedAt: new Date(),
      })
      .returning({ id: users.id, email: users.email });
    return { userId: user.id, email: user.email, created: true };
  }
}
