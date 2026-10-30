import { STATUS_CODES } from 'node:http';
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** RFC 9457 body plus the correlation id that links it to the server log. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly correlationId: string;
}

const GENERIC_DETAIL =
  'An unexpected error occurred. Quote the correlation id when reporting it.';

/** The router's own 404 ("Cannot GET /path?query") echoes the URL; drop the query, it may carry tokens. */
const withoutQuery = (message: string): string =>
  message.replace(/^(Cannot [A-Z]+ [^?\s]*)\?\S*$/, '$1');

function messageOf(response: string | object): string | null {
  if (typeof response === 'string') return withoutQuery(response);
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') return withoutQuery(message);
  if (Array.isArray(message)) return message.map(String).join('; ');
  return null;
}

/**
 * Only 4xx messages are written by our own code and safe to show; anything else (5xx, unknown
 * errors) gets a generic detail so driver errors, hosts or credentials never reach the client.
 */
export function toProblem(
  exception: unknown,
  request: { readonly url: string; readonly id: string },
): ProblemDetails {
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  const title = STATUS_CODES[status] ?? 'Error';
  const safe = exception instanceof HttpException && status < 500;
  return {
    type: 'about:blank',
    title,
    status,
    detail:
      (safe && messageOf(exception.getResponse())) ||
      (safe ? title : GENERIC_DETAIL),
    instance: request.url.split('?')[0], // the query string may carry tokens
    correlationId: request.id,
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = toProblem(exception, {
      url: request.url,
      id: String(request.id),
    });

    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${problem.instance} -> ${problem.status} [${problem.correlationId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }
}
