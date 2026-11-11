import { Module } from '@nestjs/common';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { OBJECT_STORAGE } from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

/** Private object storage behind the ObjectStorage port (S3; LocalStack in development). */
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [configuration.KEY],
      useFactory: ({ s3 }: AppConfiguration) => new S3ObjectStorage(s3),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
