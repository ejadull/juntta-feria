import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp, fastifyOptions } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(fastifyOptions()),
  );
  const env = configureApp(app);
  app.enableShutdownHooks(); // closes the readiness clients on SIGTERM
  await app.listen(env.port, env.apiHost);
}
await bootstrap();
