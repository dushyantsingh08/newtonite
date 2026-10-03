import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { idempotencyConflictError } from '@/lib/errors';
import { prisma } from '@/server/db';

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

export const computeRequestHash = (endpoint: string, body: unknown) =>
  createHash('sha256').update(`${endpoint}\n${stable(body ?? {})}`).digest('hex');

export async function withIdempotency<T>(
  p: { userId: string; key: string; endpoint: string; body: unknown },
  run: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  const hash = computeRequestHash(p.endpoint, p.body);
  
  return prisma.$transaction(async (tx) => {
    // Claim the key FIRST. A concurrent duplicate blocks on the unique index
    // until we commit (then sees our row) or roll back (then proceeds).
    const inserted = await tx.$executeRaw`
      INSERT INTO idempotency_keys (id, user_id, key, endpoint, request_hash, status_code, response_json, expires_at)
      VALUES (${randomUUID()}, ${p.userId}, ${p.key}, ${p.endpoint}, ${hash}, 0, '{}'::jsonb, now() + interval '24 hours')
      ON CONFLICT (user_id, key, endpoint) DO NOTHING
    `;
    
    const where = { userId_key_endpoint: { userId: p.userId, key: p.key, endpoint: p.endpoint } };
    
    if (inserted === 0) {
      const row = await tx.idempotencyKey.findUniqueOrThrow({ where });
      if (row.requestHash !== hash) throw idempotencyConflictError();
      return { status: row.statusCode, body: row.responseJson, replayed: true };
    }
    
    // any throw rolls back the key too, so retries re-run
    const result = await run(tx); 
    
    await tx.idempotencyKey.update({ 
      where, 
      data: { statusCode: 200, responseJson: result as Prisma.InputJsonValue } 
    });
    
    return { status: 200, body: result, replayed: false };
  });
}
