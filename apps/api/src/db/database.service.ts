import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

/** DI token for the single application pool (role juntta_app, never BYPASSRLS). */
export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Database;

  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {
    this.db = drizzle(pool, { schema });
  }

  /**
   * Runs `work` in a transaction scoped to one tenant (§2.2): `app.tenant_id` is set with
   * `set_config(..., true)`, so it ends with the transaction and never leaks to the next use of
   * the pooled connection. RLS policies read it via `current_setting('app.tenant_id', true)`.
   */
  async withTenant<T>(
    tenantId: string,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    if (!UUID.test(tenantId))
      throw new Error('Invalid tenant id: expected a UUID.');
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );
      return work(tx);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
