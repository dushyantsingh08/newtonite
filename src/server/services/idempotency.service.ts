import { createHash } from 'crypto';
import { prisma } from '@/server/db';
import { idempotencyConflictError } from '@/lib/errors';
import { Prisma, PrismaClient } from '@prisma/client';

const IDEMPOTENCY_TTL_HOURS = 24;

type PrismaTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Compute a deterministic hash of the request body for comparison.
 */
export function computeRequestHash(body: unknown): string {
  const serialized = JSON.stringify(body, Object.keys(body as object).sort());
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Check for an existing idempotency record.
 * Returns the stored response if the same request was already processed.
 * Throws if the same key was used with a different payload.
 */
export async function checkIdempotency(
  userId: string,
  key: string,
  endpoint: string,
  requestHash: string,
): Promise<{ statusCode: number; responseJson: unknown } | null> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      userId_key_endpoint: { userId, key, endpoint },
    },
  });

  if (!existing) return null;

  // Check if it's expired
  if (existing.expiresAt < new Date()) {
    // Clean up expired key
    await prisma.idempotencyKey.delete({
      where: { id: existing.id },
    });
    return null;
  }

  // Same key, same request = return stored response
  if (existing.requestHash === requestHash) {
    return {
      statusCode: existing.statusCode,
      responseJson: existing.responseJson,
    };
  }

  // Same key, different request = conflict
  throw idempotencyConflictError();
}

/**
 * Store an idempotency record within a transaction.
 */
export async function storeIdempotencyResult(
  tx: PrismaTransaction,
  userId: string,
  key: string,
  endpoint: string,
  requestHash: string,
  statusCode: number,
  responseJson: unknown,
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + IDEMPOTENCY_TTL_HOURS);

  await tx.idempotencyKey.create({
    data: {
      userId,
      key,
      endpoint,
      requestHash,
      statusCode,
      responseJson: responseJson as Prisma.InputJsonValue,
      expiresAt,
    },
  });
}
