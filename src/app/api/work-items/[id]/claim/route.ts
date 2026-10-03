import { requireAuth } from '@/server/auth';
import { withIdempotency } from '@/lib/api';
import { claimSchema } from '@/lib/validation';
import { claimWorkItem } from '@/server/services/work-item.service';

export const POST = withIdempotency(async (req, { params }, parsedBody, tx) => {
  const user = await requireAuth();
  const { id } = await params;
  const item = await claimWorkItem(tx, user, id);
  return { status: 200, data: { data: item } };
}, claimSchema);
