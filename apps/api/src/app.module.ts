import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from './config/configuration.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `npm run dev:api` runs from apps/api; the template lives at the repo root.
      // Compose injects variables directly, so the files are optional.
      envFilePath: ['.env', '../../.env'],
      load: [configuration],
    }),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
