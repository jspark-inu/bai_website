import { requireApiMember } from '@/lib/auth';
import { privateJsonResponse } from '@/lib/exact-json-response';
import {
  AvailabilityInputError,
  getWeeklyAvailability,
  updateWeeklyAvailability,
} from '@/lib/services/availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const weekStart = request ? new URL(request.url).searchParams.get('week') || undefined : undefined;
  try {
    return privateJsonResponse(getWeeklyAvailability(auth.member, weekStart));
  } catch (error) {
    if (error instanceof AvailabilityInputError) {
      return privateJsonResponse({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return privateJsonResponse({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const result = updateWeeklyAvailability(auth.member, input);
    if (!result.ok) {
      return privateJsonResponse({ error: result.error }, { status: result.status });
    }
    return privateJsonResponse({
      week: result.week,
      unavailable: result.unavailable,
      slots: result.slots,
    });
  } catch (error) {
    if (error instanceof AvailabilityInputError) {
      return privateJsonResponse({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
