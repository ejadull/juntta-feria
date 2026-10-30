import { defer, of, type Observable } from 'rxjs';
import type { LayoutVersionDto } from '../domain/layout.types';
import { validateLayout } from '../domain/validation';
import { DEMO_LAYOUT, STRESS_LAYOUT } from './demo-layout';
import {
  LayoutNotEditableError,
  LayoutNotFoundError,
  LayoutRepository,
  PublishRejectedError,
} from './layout.repository';

/**
 * Stand-in for the LAY-01 backend. Mimics its rules (drafts only, validate on publish)
 * so the editor behaves the same once HttpLayoutRepository replaces it.
 */
export class InMemoryLayoutRepository extends LayoutRepository {
  private readonly versions = new Map<string, LayoutVersionDto>();

  constructor(
    seed: readonly LayoutVersionDto[] = [DEMO_LAYOUT, STRESS_LAYOUT],
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {
    super();
    seed.forEach((v) => this.versions.set(v.id, v));
  }

  get(versionId: string): Observable<LayoutVersionDto> {
    return defer(() => of(this.require(versionId)));
  }

  saveDraft(version: LayoutVersionDto): Observable<LayoutVersionDto> {
    return defer(() => {
      const stored = this.requireDraft(version.id);
      const saved: LayoutVersionDto = { ...stored, objects: version.objects };
      return of(this.store(saved));
    });
  }

  publish(versionId: string): Observable<LayoutVersionDto> {
    return defer(() => {
      const draft = this.requireDraft(versionId);
      const issues = validateLayout(draft);
      if (issues.length > 0) throw new PublishRejectedError(issues);
      return of(this.store({ ...draft, status: 'PUBLISHED' }));
    });
  }

  cloneAsDraft(versionId: string): Observable<LayoutVersionDto> {
    return defer(() => {
      const source = this.require(versionId);
      const siblings = [...this.versions.values()].filter(
        (v) => v.templateId === source.templateId,
      );
      const draft: LayoutVersionDto = {
        ...source,
        id: this.newId(),
        version: Math.max(...siblings.map((v) => v.version)) + 1,
        status: 'DRAFT',
        objects: source.objects.map((o) => ({ ...o, id: this.newId() })),
      };
      return of(this.store(draft));
    });
  }

  private store(version: LayoutVersionDto): LayoutVersionDto {
    this.versions.set(version.id, version);
    return version;
  }

  private require(versionId: string): LayoutVersionDto {
    const version = this.versions.get(versionId);
    if (!version) throw new LayoutNotFoundError(versionId);
    return version;
  }

  private requireDraft(versionId: string): LayoutVersionDto {
    const version = this.require(versionId);
    if (version.status !== 'DRAFT') throw new LayoutNotEditableError(versionId);
    return version;
  }
}
