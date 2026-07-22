import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { createInquiry, getInquiries } from '@/lib/services/inquiries';
import { exactJsonResponse } from '@/lib/exact-json-response';
import { readJsonObject, writeResultResponse } from '@/lib/write-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return exactJsonResponse(getInquiries());
}

export async function POST(request: NextRequest) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return writeResultResponse(createInquiry(auth.member.id, await readJsonObject(request)));
}