import { Global, Logger, Module } from '@nestjs/common';
import pg from 'pg';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { DatabaseService, PG_POOL } from './database.service.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [configuration.KEY],
      useFactory: (env: AppConfiguration) => {
        const pool = new pg.Pool({
          connectionString: env.databaseUrl,
          max: env.dbPoolMax,
        });
        // Idle-client errors would otherwise crash the process; the next query reports them.
        pool.on('error', (e) =>
          new Logger('Database').warn(`idle client: ${e.message}`),
        );
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [PG_POOL, DatabaseService],
})
export class DatabaseModule {}
