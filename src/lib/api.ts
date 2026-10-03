import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { ZodError } from 'zod';
import { clearAuthCache } from '@/server/authorization';
import { checkIdempotency, storeIdempotencyResult, computeRequestHash } from '@/server/services/idempotency.service';
import { requireAuth } from '@/server/auth';
import { prisma } from '@/server/db';

/**
 * Wraps an API route handler to provide common functionality:
 * - Error catching and structured JSON responses
 * - Clearing auth cache after request
 */
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
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request data',
              details: error.format(),
            },
          },
          { status: 400 },
        );
      }

      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        },
        { status: 500 },
      );
    } finally {
      clearAuthCache();
    }
  };
}

/**
 * Wraps a mutation API route with idempotency support.
 */
export function withIdempotency(
  handler: (req: Request, context: any, parsedBody: any) => Promise<{ status: number; data: any }>,
  bodySchema?: any // Zod schema
) {
  return withApiRoute(async (req, context) => {
    const user = await requireAuth();
    const idempotencyKey = req.headers.get('idempotency-key');
    const endpoint = new URL(req.url).pathname;

    let parsedBody: any = null;
    let requestHash = '';

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const rawBody = await req.text();
      const jsonBody = rawBody ? JSON.parse(rawBody) : {};
      
      if (bodySchema) {
        parsedBody = bodySchema.parse(jsonBody);
      } else {
        parsedBody = jsonBody;
      }
      
      requestHash = computeRequestHash(jsonBody);
    }

    if (idempotencyKey) {
      const existing = await checkIdempotency(user.id, idempotencyKey, endpoint, requestHash);
      if (existing) {
        return NextResponse.json(existing.responseJson, { status: existing.statusCode });
      }
    }

    // Execute the handler
    const result = await handler(req, context, parsedBody);

    // If we have an idempotency key and the handler succeeded, store the result
    if (idempotencyKey && result.status >= 200 && result.status < 300) {
       await prisma.$transaction(async (tx) => {
         await storeIdempotencyResult(
           tx,
           user.id,
           idempotencyKey,
           endpoint,
           requestHash,
           result.status,
           result.data
         );
       });
    }

    return NextResponse.json(result.data, { status: result.status });
  });
}
