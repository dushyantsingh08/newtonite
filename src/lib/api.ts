import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { withIdempotency as idempWrapper } from '@/server/services/idempotency.service';
import { requireAuth } from '@/server/auth';

export function withApiRoute(
  handler: (req: Request, context: any) => Promise<NextResponse | Response>,
) {
  return async (req: Request, context: any) => {
    try {
      const response = await handler(req, context);
      return response;
    } catch (error) {
      console.error(`[API Error] ${req.method} ${req.url}:`, error);

      if (error instanceof AppError) {
        return NextResponse.json(error.toJSON(), { status: error.statusCode });
      }

      if (error instanceof ZodError) {
        return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: error.format() } }, { status: 400 });
      }

      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, { status: 500 });
    }
  };
}

export function withIdempotency(
  handler: (req: Request, context: any, parsedBody: any, tx: Prisma.TransactionClient) => Promise<{ status: number; data: any }>,
  bodySchema?: any
) {
  return withApiRoute(async (req, context) => {
    const user = await requireAuth();
    const idempotencyKey = req.headers.get('idempotency-key');
    const endpoint = new URL(req.url).pathname;

    if (!idempotencyKey) {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required', 400);
    }

    const rawBody = await req.text();
    const jsonBody = rawBody ? JSON.parse(rawBody) : {};
    const parsedBody = bodySchema ? bodySchema.parse(jsonBody) : jsonBody;

    const result = await idempWrapper({
      userId: user.id,
      key: idempotencyKey,
      endpoint,
      body: jsonBody
    }, async (tx) => {
      const handlerResult = await handler(req, context, parsedBody, tx);
      return handlerResult.data;
    });

    return NextResponse.json(result.body, { status: result.status });
  });
}
