import { TalentOfficeError } from './talent-office';
import type { MemberPublic } from './types';

export function isTalentOperator(member: MemberPublic) {
  return member.role === 'pi' || member.role === 'operator';
}

export function talentErrorResponse(error: unknown) {
  if (error instanceof TalentOfficeError) return Response.json({ error: error.message }, { status: error.status });
  console.error('talent office error', error);
  return Response.json({ error: 'internal server error' }, { status: 500 });
}

export function apiTalentRequest(row: Record<string, unknown>) {
  return row;
}
