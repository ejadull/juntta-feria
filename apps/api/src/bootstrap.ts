import fastifyCookie from '@fastify/cookie';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { FastifyServerOptions } from 'fastify';
import {
  configuration,
  type AppConfiguration,
} from './config/configuration.js';
import {
  CORRELATION_HEADER,
  correlationIdFrom,
} from './http/correlation-id.js';
import { ProblemDetailsFilter } from './http/problem-details.filter.js';

/** Fastify request id = correlation id (validated incoming header or a new UUID). */
export function fastifyOptions(): FastifyServerOptions {
  return {
    requestIdHeader: false,
    genReqId: (req) => correlationIdFrom(req.headers[CORRELATION_HEADER]),
  };
}

/**
 * Everything main.ts and the tests share: prefix, CORS, correlation id, errors, cookies (refresh
 * token, ADR 0004), OpenAPI. Call before `app.init()`.
 */
export async function configureApp(
  app: NestFastifyApplication,
): Promise<AppConfiguration> {
  const env = app.get<AppConfiguration>(configuration.KEY);

  await app.register(fastifyCookie);
  app.setGlobalPrefix(env.apiPrefix);
  const anyOrigin = env.corsOrigins.includes('*'); // rejected in production by the env schema
  app.enableCors({
    origin: anyOrigin ? '*' : [...env.corsOrigins],
    credentials: !anyOrigin, // refresh cookie (ADR 0004) needs credentials; never with '*'
    exposedHeaders: [CORRELATION_HEADER],
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request, reply) => {
      reply.header(CORRELATION_HEADER, request.id);
    });

  if (env.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Juntta Feria API')
        .setVersion('v1')
        .build(),
    );
    SwaggerModule.setup(`${env.apiPrefix}/docs`, app, document);
  }
  return env;
}
