import { requireAuth } from '@/server/auth';
import { withIdempotency } from '@/lib/api';
import { approveSchema } from '@/lib/validation';
import { approveWorkItem } from '@/server/services/work-item.service';

export const POST = withIdempotency(async (req, { params }, parsedBody, tx) => {
  const user = await requireAuth();
  const { id } = await params;
  const item = await approveWorkItem(tx, user, id, parsedBody.expectedVersion);
  return { status: 200, data: { data: item } };
}, approveSchema);
