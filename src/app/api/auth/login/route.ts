import { NextResponse } from 'next/server';
import { withApiRoute } from '@/lib/api';
import { login } from '@/server/auth';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const POST = withApiRoute(async (req) => {
  const body = await req.json();
  const { email, password } = loginSchema.parse(body);
  const user = await login(email, password);
  return NextResponse.json({ data: user }, { status: 200 });
});
