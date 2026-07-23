import type { MemberPublic } from '../types.ts';
import { getDb } from '../db/client.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import {
  readAvailabilityForMember,
  readAvailabilitySummary,
  replaceAvailabilityInTransaction,
  type AvailabilitySlot,
} from '../db/repositories/availability.ts';

export class AvailabilityInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AvailabilityInputError';
  }
}

export function parseAvailabilityPayload(input: unknown): AvailabilitySlot[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { slots?: unknown }).slots)) {
    throw new AvailabilityInputError('slots must be an array');
  }

  const unique = new Map<string, AvailabilitySlot>();
  for (const candidate of (input as { slots: unknown[] }).slots) {
    if (!candidate || typeof candidate !== 'object') {
      throw new AvailabilityInputError('each slot must include day and hour');
    }
    const { day, hour } = candidate as { day?: unknown; hour?: unknown };
    if (!Number.isInteger(day) || !Number.isInteger(hour)
      || Number(day) < 0 || Number(day) > 4 || Number(hour) < 0 || Number(hour) > 23) {
      throw new AvailabilityInputError('day must be 0-4 and hour must be 0-23');
    }
    unique.set(`${day}-${hour}`, { day: Number(day), hour: Number(hour) });
  }
  return [...unique.values()].sort((a, b) => a.day - b.day || a.hour - b.hour);
}

export function getWeeklyAvailability(member: MemberPublic) {
  const conn = getDb();
  return {
    member: { id: member.id, name: member.name, role: member.role },
    slots: readAvailabilityForMember(conn, member.id),
    summary: member.role === 'pi' ? readAvailabilitySummary(conn) : null,
  };
}

export function updateWeeklyAvailability(member: MemberPublic, input: unknown) {
  const slots = parseAvailabilityPayload(input);
  const saved = withWriteTransaction((conn) => {
    const active = replaceAvailabilityInTransaction(conn, member.id, slots);
    if (!active) return false;
    conn.prepare(`INSERT INTO audit_log (actor_id,target_member_id,action,detail)
      VALUES (?,?,?,?)`).run(member.id, member.id, 'weekly_availability_update', JSON.stringify({ count: slots.length }));
    return true;
  });
  return saved ? { ok: true as const, slots } : { ok: false as const, status: 401, error: 'login required' };
}
