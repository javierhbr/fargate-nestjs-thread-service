import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void) {
    const correlationId = (req.headers[CORRELATION_ID_HEADER] as string) || uuidv4();

    // Add to request for downstream use
    (req as FastifyRequest['raw'] & { correlationId: string }).correlationId =
      correlationId;

    // Add to response headers
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}
