import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import {
  layoutObjects,
  layoutTemplates,
  layoutVersions,
  venues,
  type LayoutObjectKind,
  type LayoutVersionStatus,
} from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import type { CreateTemplateInput, LayoutObjectInput } from './layout.input.js';
import { validateLayoutVersion } from './layout-validation.js';

/** Persisted contract shared with the editor (LUI-05 D2). */
export interface LayoutObjectDto {
  readonly id: string;
  readonly kind: LayoutObjectKind;
  readonly code: string | null;
  readonly geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  readonly metadata: Record<string, unknown>;
}

export interface LayoutVersionDto {
  readonly id: string;
  readonly templateId: string;
  readonly version: number;
  readonly status: LayoutVersionStatus;
  readonly widthM: number;
  readonly heightM: number;
  readonly publishedAt: Date | null;
  readonly objects: readonly LayoutObjectDto[];
}

export interface LayoutTemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly venueId: string | null;
  readonly versions: readonly {
    id: string;
    version: number;
    status: LayoutVersionStatus;
    publishedAt: Date | null;
  }[];
}

const NOT_FOUND = 'Layout not found.';
const NOT_DRAFT = 'Only a draft version can change; clone it into a new draft.';

const versionView = {
  id: layoutVersions.id,
  templateId: layoutVersions.templateId,
  version: layoutVersions.version,
  status: layoutVersions.status,
  widthM: layoutVersions.widthM,
  heightM: layoutVersions.heightM,
  publishedAt: layoutVersions.publishedAt,
};
type VersionRow = Omit<LayoutVersionDto, 'objects'>;

const geometrySql = (geometry: LayoutObjectDto['geometry']) =>
  sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 0)`;

/**
 * Layout templates and versions (LAY-01). Every query runs in `withTenant` (RLS); version state
 * changes lock the version row, and the database triggers keep published versions frozen.
 */
@Injectable()
export class LayoutsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  listTemplates(tenantId: string): Promise<LayoutTemplateSummary[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      const templates = await tx
        .select({ id: layoutTemplates.id, name: layoutTemplates.name, venueId: layoutTemplates.venueId })
        .from(layoutTemplates)
        .orderBy(sql`lower(${layoutTemplates.name})`);
      if (templates.length === 0) return [];
      const versions = await tx
        .select({
          templateId: layoutVersions.templateId,
          id: layoutVersions.id,
          version: layoutVersions.version,
          status: layoutVersions.status,
          publishedAt: layoutVersions.publishedAt,
        })
        .from(layoutVersions)
        .where(inArray(layoutVersions.templateId, templates.map((t) => t.id)))
        .orderBy(asc(layoutVersions.version));
      return templates.map((t) => ({
        ...t,
        versions: versions
          .filter((v) => v.templateId === t.id)
          .map((v) => ({ id: v.id, version: v.version, status: v.status, publishedAt: v.publishedAt })),
      }));
    });
  }

  createTemplate(
    tenantId: string,
    actorId: string,
    input: CreateTemplateInput,
  ): Promise<LayoutVersionDto> {
    return this.unique('A layout template with that name already exists.', () =>
      this.database.withTenant(tenantId, async (tx) => {
        const size = await this.sizeFor(tx, input);
        const [template] = await tx
          .insert(layoutTemplates)
          .values({ name: input.name, venueId: input.venueId ?? null })
          .returning({ id: layoutTemplates.id });
        const [version] = await tx
          .insert(layoutVersions)
          .values({ templateId: template.id, version: 1, ...size })
          .returning(versionView);
        await this.audit.record(tx, {
          actorId,
          action: 'layout_template.created',
          entityType: 'layout_template',
          entityId: template.id,
          after: { name: input.name, venueId: input.venueId ?? null, ...size },
        });
        return { ...version, objects: [] };
      }),
    );
  }

  getVersion(tenantId: string, versionId: string): Promise<LayoutVersionDto | null> {
    return this.database.withTenant(tenantId, async (tx) => {
      const version = await this.findVersion(tx, versionId);
      return version && this.withObjects(tx, version);
    });
  }

  /** Replaces every object of a draft (the editor saves the whole draft, LUI-05 D6). */
  saveObjects(
    tenantId: string,
    actorId: string,
    versionId: string,
    objects: readonly LayoutObjectInput[],
  ): Promise<LayoutVersionDto> {
    return this.database.withTenant(tenantId, async (tx) => {
      const version = await this.draft(tx, versionId);
      await tx.delete(layoutObjects).where(eq(layoutObjects.layoutVersionId, versionId));
      if (objects.length > 0)
        await tx.insert(layoutObjects).values(
          objects.map((o) => ({
            id: o.id,
            layoutVersionId: versionId,
            kind: o.kind,
            code: o.code,
            geometry: geometrySql(o.geometry),
            metadata: o.metadata,
          })),
        );
      await this.audit.record(tx, {
        actorId,
        action: 'layout_version.saved',
        entityType: 'layout_version',
        entityId: versionId,
        after: { objects: objects.length },
      });
      return this.withObjects(tx, version);
    });
  }

  /** Validates with PostGIS (INV-04); on success the previous published version is archived. */
  publish(tenantId: string, actorId: string, versionId: string): Promise<LayoutVersionDto> {
    return this.database.withTenant(tenantId, async (tx) => {
      const version = await this.draft(tx, versionId);
      const issues = await validateLayoutVersion(tx, versionId, version.widthM, version.heightM);
      if (issues.length > 0)
        throw new UnprocessableEntityException({
          message: `The layout has ${issues.length} issue(s) and cannot be published.`,
          issues,
        });
      await tx
        .update(layoutVersions)
        .set({ status: 'ARCHIVED' })
        .where(
          and(
            eq(layoutVersions.templateId, version.templateId),
            eq(layoutVersions.status, 'PUBLISHED'),
          ),
        );
      const [published] = await tx
        .update(layoutVersions)
        .set({ status: 'PUBLISHED', publishedAt: new Date() })
        .where(eq(layoutVersions.id, versionId))
        .returning(versionView);
      await this.audit.record(tx, {
        actorId,
        action: 'layout_version.published',
        entityType: 'layout_version',
        entityId: versionId,
        after: { templateId: version.templateId, version: version.version },
      });
      return this.withObjects(tx, published);
    });
  }

  /** Next draft of a template from any of its versions; object ids are kept (INV-06). */
  cloneVersion(
    tenantId: string,
    actorId: string,
    templateId: string,
    sourceVersionId: string,
  ): Promise<LayoutVersionDto> {
    return this.unique('The template already has a draft version.', () =>
      this.database.withTenant(tenantId, async (tx) => {
        // Serializes version numbering per template.
        const [template] = await tx
          .select({ id: layoutTemplates.id })
          .from(layoutTemplates)
          .where(eq(layoutTemplates.id, templateId))
          .for('update');
        const source = template && (await this.findVersion(tx, sourceVersionId));
        if (!source || source.templateId !== templateId) throw new NotFoundException(NOT_FOUND);

        const [{ last }] = await tx
          .select({ last: max(layoutVersions.version) })
          .from(layoutVersions)
          .where(eq(layoutVersions.templateId, templateId));
        const [draft] = await tx
          .insert(layoutVersions)
          .values({
            templateId,
            version: (last ?? 0) + 1,
            widthM: source.widthM,
            heightM: source.heightM,
          })
          .returning(versionView);
        await tx.execute(sql`
          INSERT INTO layout_objects (id, layout_version_id, kind, code, geometry, metadata)
          SELECT id, ${draft.id}, kind, code, geometry, metadata
          FROM layout_objects WHERE layout_version_id = ${sourceVersionId}`);
        await this.audit.record(tx, {
          actorId,
          action: 'layout_version.cloned',
          entityType: 'layout_version',
          entityId: draft.id,
          after: { templateId, version: draft.version, sourceVersionId },
        });
        return this.withObjects(tx, draft);
      }),
    );
  }

  private async sizeFor(
    tx: Transaction,
    input: CreateTemplateInput,
  ): Promise<{ widthM: number; heightM: number }> {
    if (input.widthM !== undefined && input.heightM !== undefined)
      return { widthM: input.widthM, heightM: input.heightM };
    const [venue] = await tx
      .select({ widthM: venues.widthM, heightM: venues.heightM })
      .from(venues)
      .where(eq(venues.id, input.venueId!));
    if (!venue) throw new NotFoundException('Venue not found.');
    return venue;
  }

  private async findVersion(
    tx: Transaction,
    versionId: string,
    forUpdate = false,
  ): Promise<VersionRow | null> {
    const query = tx.select(versionView).from(layoutVersions).where(eq(layoutVersions.id, versionId));
    const [version] = await (forUpdate ? query.for('update') : query);
    return version ?? null;
  }

  /** Locks the version and requires it to be a draft (404 / 409 otherwise). */
  private async draft(tx: Transaction, versionId: string): Promise<VersionRow> {
    const version = await this.findVersion(tx, versionId, true);
    if (!version) throw new NotFoundException(NOT_FOUND);
    if (version.status !== 'DRAFT') throw new ConflictException(NOT_DRAFT);
    return version;
  }

  private async withObjects(tx: Transaction, version: VersionRow): Promise<LayoutVersionDto> {
    const objects = await tx
      .select({
        id: layoutObjects.id,
        kind: layoutObjects.kind,
        code: layoutObjects.code,
        geometry: sql<LayoutObjectDto['geometry']>`ST_AsGeoJSON(${layoutObjects.geometry})::json`,
        metadata: layoutObjects.metadata,
      })
      .from(layoutObjects)
      .where(eq(layoutObjects.layoutVersionId, version.id))
      .orderBy(asc(layoutObjects.kind), asc(layoutObjects.code), asc(layoutObjects.id));
    return { ...version, objects };
  }

  /** Unique indexes are the source of truth (names, one draft per template): no check-then-insert race. */
  private async unique<T>(message: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(message);
      throw error;
    }
  }
}
