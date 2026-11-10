import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
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

  it('passes a 4xx `issues` list through as an extension member', () => {
    const issues = [{ code: 'STAND_OVERLAP', objectIds: ['a', 'b'] }];
    const problem = toProblem(
      new UnprocessableEntityException({
        message: 'Layout has 1 issue',
        issues,
      }),
      req,
    );
    expect(problem).toMatchObject({
      status: 422,
      detail: 'Layout has 1 issue',
      issues,
    });
  });

  it('passes a 4xx machine-readable `code` through (§5 error format)', () => {
    const problem = toProblem(
      new ConflictException({
        message: 'The stand is not available.',
        code: 'STAND_UNAVAILABLE',
      }),
      req,
    );
    expect(problem).toMatchObject({ status: 409, code: 'STAND_UNAVAILABLE' });
    expect(toProblem(new NotFoundException('x'), req)).not.toHaveProperty(
      'code',
    );
  });

  it('never exposes `issues` from a 5xx', () => {
    const problem = toProblem(
      new HttpException({ message: 'x', issues: [{ secret: true }] }, 500),
      req,
    );
    expect(problem).not.toHaveProperty('issues');
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

  it('passes the machine `code` of a 503 through, still hiding its message', () => {
    const problem = toProblem(
      new ServiceUnavailableException({
        message: 'keys at 10.0.0.3 down',
        code: 'GOOGLE_SIGN_IN_UNAVAILABLE',
      }),
      req,
    );
    expect(problem).toMatchObject({
      status: 503,
      code: 'GOOGLE_SIGN_IN_UNAVAILABLE',
    });
    expect(problem.detail).not.toContain('10.0.0.3');
  });

  it('treats thrown non-errors as 500', () => {
    expect(toProblem('boom', req).status).toBe(500);
  });
});
