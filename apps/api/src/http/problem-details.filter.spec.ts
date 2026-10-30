import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { toProblem } from './problem-details.filter.js';

const req = { url: '/api/v1/things/7?token=secret', id: 'corr-1234' };

describe('toProblem (RFC 9457)', () => {
  it('maps a 4xx HttpException with its message, path-only instance and correlation id', () => {
    expect(toProblem(new NotFoundException('Stand not found'), req)).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Stand not found',
      instance: '/api/v1/things/7',
      correlationId: 'corr-1234',
    });
  });

  it('strips the query string from the router "Cannot GET" message', () => {
    const problem = toProblem(
      new NotFoundException('Cannot GET /api/v1/x?token=secret'),
      req,
    );
    expect(problem.detail).toBe('Cannot GET /api/v1/x');
  });

  it('joins validation messages', () => {
    const problem = toProblem(
      new BadRequestException(['name is required', 'price must be > 0']),
      req,
    );
    expect(problem.status).toBe(400);
    expect(problem.detail).toBe('name is required; price must be > 0');
  });

  it('accepts a plain string response', () => {
    expect(toProblem(new HttpException('Slow down', 429), req)).toMatchObject({
      status: 429,
      title: 'Too Many Requests',
      detail: 'Slow down',
    });
  });

  it('hides the cause of unknown errors behind a generic 500', () => {
    const problem = toProblem(
      new Error('connect ECONNREFUSED postgres://user:pass@db'),
      req,
    );
    expect(problem).toMatchObject({
      status: 500,
      title: 'Internal Server Error',
    });
    expect(JSON.stringify(problem)).not.toMatch(/ECONNREFUSED|pass|postgres/);
  });

  it('keeps a 5xx status but never its message', () => {
    const problem = toProblem(
      new ServiceUnavailableException('redis at 10.0.0.3 down'),
      req,
    );
    expect(problem.status).toBe(503);
    expect(problem.detail).not.toContain('10.0.0.3');
  });

  it('treats thrown non-errors as 500', () => {
    expect(toProblem('boom', req).status).toBe(500);
  });
});
