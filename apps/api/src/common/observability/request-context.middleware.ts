import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * ARCHITECTURE.md §AJ: "`request_id` (propagated from an `X-Request-Id`
 * header)". Honors a caller-supplied `X-Request-Id` (e.g. from an
 * upstream load balancer/gateway that already assigns one) so a trace can
 * span beyond this service; generates one when absent rather than leaving
 * `audit_logs.request_id` null for direct/first-hop requests. Echoed back
 * on the response so a client that didn't send one can still correlate
 * its own logs with this request's audit rows.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = incoming && incoming.trim().length > 0 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    requestContextStorage.run({ requestId }, () => next());
  }
}
