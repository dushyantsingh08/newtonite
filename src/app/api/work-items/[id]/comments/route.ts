import { requireAuth } from '@/server/auth';
import { withIdempotency } from '@/lib/api';
import { commentSchema } from '@/lib/validation';
import { addComment } from '@/server/services/work-item.service';

export const POST = withIdempotency(async (req, { params }, parsedBody) => {
  const user = await requireAuth();
  const { id } = await params;
  const commentEvent = await addComment(user, id, parsedBody.text);
  return { status: 201, data: { data: commentEvent } };
}, commentSchema);
