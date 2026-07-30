import type { MemberPublic } from '../types.ts';
import { getDb } from '../db/client.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import {
  readAvailabilityForMember,
  readAvailabilityResponseForMember,
  readAvailabilitySummary,
  readAvailabilityWeekStarts,
  replaceAvailabilityInTransaction,
  type AvailabilitySlot,
} from '../db/repositories/availability.ts';

export class AvailabilityInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'AvailabilityInputError';
  }
}

export type AvailabilityPayload = { weekStart: string; slots: AvailabilitySlot[]; unavailable: boolean };
export type AvailabilityWeek = { start: string; end: string; days: string[] };
export type AvailabilityWeekOption = AvailabilityWeek & { current: boolean };

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function nextWeekWindow(now = new Date()): AvailabilityWeek {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const koreanToday = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const daysUntilNextMonday = ((8 - koreanToday.getUTCDay()) % 7) || 7;
  const monday = new Date(koreanToday);
  monday.setUTCDate(monday.getUTCDate() + daysUntilNextMonday);
  const days = Array.from({ length: 5 }, (_, offset) => {
    const date = new Date(monday);
    date.setUTCDate(date.getUTCDate() + offset);
    return isoDate(date);
  });
  return { start: days[0], end: days[4], days };
}

function availabilityWeekFromStart(start: string): AvailabilityWeek {
  const monday = new Date(`${start}T00:00:00Z`);
  const days = Array.from({ length: 5 }, (_, offset) => {
    const date = new Date(monday);
    date.setUTCDate(date.getUTCDate() + offset);
    return isoDate(date);
  });
  return { start: days[0], end: days[4], days };
}

export function parseAvailabilityPayload(input: unknown): AvailabilityPayload {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { slots?: unknown }).slots)) {
    throw new AvailabilityInputError('slots must be an array');
  }

  const weekStart = (input as { weekStart?: unknown }).weekStart;
  if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new AvailabilityInputError('weekStart must be an ISO date');
  }

  const unavailableValue = (input as { unavailable?: unknown }).unavailable;
  if (unavailableValue !== undefined && typeof unavailableValue !== 'boolean') {
    throw new AvailabilityInputError('unavailable must be a boolean');
  }
  const unavailable = unavailableValue === true;

  const unique = new Map<string, AvailabilitySlot>();
  for (const candidate of (input as { slots: unknown[] }).slots) {
    if (!candidate || typeof candidate !== 'object') {
      throw new AvailabilityInputError('each slot must include day and hour');
    }
    const { day, hour } = candidate as { day?: unknown; hour?: unknown };
    if (!Number.isInteger(day) || !Number.isInteger(hour)
      || Number(day) < 0 || Number(day) > 4 || Number(hour) < 10 || Number(hour) > 23) {
      throw new AvailabilityInputError('day must be 0-4 and hour must be 10-23');
    }
    unique.set(`${day}-${hour}`, { day: Number(day), hour: Number(hour) });
  }
  const slots = [...unique.values()].sort((a, b) => a.day - b.day || a.hour - b.hour);
  if (unavailable && slots.length) {
    throw new AvailabilityInputError('unavailable responses cannot include slots');
  }
  return { weekStart, slots, unavailable };
}

export function getWeeklyAvailability(member: MemberPublic, requestedWeekStart?: string) {
  const conn = getDb();
  const currentWeek = nextWeekWindow();
  const weekStarts = [...new Set([currentWeek.start, ...readAvailabilityWeekStarts(conn)])]
    .sort((a, b) => b.localeCompare(a));
  const selectedWeekStart = requestedWeekStart || currentWeek.start;
  if (!weekStarts.includes(selectedWeekStart)) {
    throw new AvailabilityInputError('availability week not found', 404);
  }
  const week = availabilityWeekFromStart(selectedWeekStart);
  const response = readAvailabilityResponseForMember(conn, member.id, week.start);
  return {
    member: { id: member.id, name: member.name, role: member.role },
    week,
    weeks: weekStarts.map((start): AvailabilityWeekOption => ({
      ...availabilityWeekFromStart(start), current: start === currentWeek.start,
    })),
    editable: week.start === currentWeek.start,
    responded: response.responded,
    unavailable: response.unavailable,
    slots: readAvailabilityForMember(conn, member.id, week.start),
    summary: member.role === 'pi' ? readAvailabilitySummary(conn, week.start) : null,
  };
}

export function updateWeeklyAvailability(member: MemberPublic, input: unknown) {
  const { weekStart, slots, unavailable } = parseAvailabilityPayload(input);
  const week = nextWeekWindow();
  if (weekStart !== week.start) {
    throw new AvailabilityInputError('availability week changed; refresh and try again', 409);
  }
  const saved = withWriteTransaction((conn) => {
    const active = replaceAvailabilityInTransaction(conn, member.id, week.start, slots, unavailable);
    if (!active) return false;
    conn.prepare(`INSERT INTO audit_log (actor_id,target_member_id,action,detail)
      VALUES (?,?,?,?)`).run(member.id, member.id, 'weekly_availability_update', JSON.stringify({
        weekStart: week.start, count: slots.length, unavailable,
      }));
    return true;
  });
  return saved
    ? { ok: true as const, week, slots, unavailable }
    : { ok: false as const, status: 401, error: 'login required' };
}
