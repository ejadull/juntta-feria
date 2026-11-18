import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { PHOTO_URL_TTL_SECONDS } from '../exhibitors/photo-policy.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';

/** What a share link needs: the publication, its people and place, and a presigned file. */
export interface SharedMedia {
  readonly id: string;
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly url: string;
  readonly contentType: string;
  readonly caption: string | null;
  readonly exhibitorName: string;
  readonly eventName: string;
  readonly eventSlug: string;
}

type SharedMediaRow = Record<string, unknown> & {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  storage_key: string;
  content_type: string;
  caption: string | null;
  exhibitor_name: string;
  event_name: string;
  event_slug: string;
};

/**
 * Looks up one publication for its share link. The database function applies the same visibility
 * as the public map (ready, not hidden, consented, event still running); anything else is "not found".
 */
@Injectable()
export class PublicShareService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async find(mediaId: string): Promise<SharedMedia | null> {
    const { rows } = await this.database.db.execute<SharedMediaRow>(
      sql`SELECT * FROM public_media_share(${mediaId}::uuid)`,
    );
    const row = rows[0];
    if (!row) return null;
    const url = await this.storage.presignDownload({
      key: row.storage_key,
      fileName: row.kind === 'VIDEO' ? 'video' : 'foto',
      contentType: row.content_type,
      expiresInSeconds: PHOTO_URL_TTL_SECONDS,
      inline: true,
    });
    return {
      id: mediaId,
      kind: row.kind,
      url,
      contentType: row.content_type,
      caption: row.caption?.trim() || null,
      exhibitorName: row.exhibitor_name,
      eventName: row.event_name,
      eventSlug: row.event_slug,
    };
  }
}
