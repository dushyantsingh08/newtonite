import { requireAuth } from '@/server/auth';
import { withIdempotency } from '@/lib/api';
import { transitionSchema } from '@/lib/validation';
import { transitionWorkItem } from '@/server/services/work-item.service';

export const POST = withIdempotency(async (req, { params }, parsedBody, tx) => {
  const user = await requireAuth();
  const { id } = await params;
  const item = await transitionWorkItem(tx, user, id, parsedBody);
  return { status: 200, data: { data: item } };
}, transitionSchema);
