import type Database from 'better-sqlite3';

export type AvailabilitySlot = { day: number; hour: number };
export type AvailabilitySummarySlot = AvailabilitySlot & { count: number; names: string[] };
export type AvailabilitySummary = {
  memberCount: number;
  respondedCount: number;
  unavailableCount: number;
  unavailableNames: string[];
  slots: AvailabilitySummarySlot[];
};
export type AvailabilityResponse = { responded: boolean; unavailable: boolean };

export function readAvailabilityForMember(
  conn: Database.Database,
  memberId: number,
  weekStart: string,
): AvailabilitySlot[] {
  return conn.prepare(`SELECT wa.day_of_week AS day,wa.hour
    FROM weekly_availability wa
    JOIN availability_responses ar ON ar.member_id=wa.member_id
    WHERE wa.member_id=? AND ar.week_start=? AND ar.unavailable=0 AND wa.hour>=10
    ORDER BY wa.day_of_week,wa.hour`).all(memberId, weekStart) as AvailabilitySlot[];
}

export function readAvailabilityResponseForMember(
  conn: Database.Database,
  memberId: number,
  weekStart: string,
): AvailabilityResponse {
  const row = conn.prepare(`SELECT unavailable FROM availability_responses
    WHERE member_id=? AND week_start=?`).get(memberId, weekStart) as { unavailable: number } | undefined;
  return { responded: row !== undefined, unavailable: row?.unavailable === 1 };
}

export function replaceAvailabilityInTransaction(
  conn: Database.Database,
  memberId: number,
  weekStart: string,
  slots: readonly AvailabilitySlot[],
  unavailable: boolean,
): boolean {
  const active = conn.prepare("SELECT 1 FROM members WHERE id=? AND status='active'").get(memberId);
  if (!active) return false;

  conn.prepare('DELETE FROM weekly_availability WHERE member_id=?').run(memberId);
  conn.prepare(`INSERT INTO availability_responses (member_id,week_start,unavailable,updated_at)
    VALUES (?,?,?,datetime('now'))
    ON CONFLICT(member_id) DO UPDATE SET
      week_start=excluded.week_start,
      unavailable=excluded.unavailable,
      updated_at=excluded.updated_at`).run(memberId, weekStart, unavailable ? 1 : 0);
  const insert = conn.prepare(`INSERT INTO weekly_availability
    (member_id,day_of_week,hour,updated_at) VALUES (?,?,?,datetime('now'))`);
  if (!unavailable) {
    for (const slot of slots) insert.run(memberId, slot.day, slot.hour);
  }
  return true;
}

export function readAvailabilitySummary(conn: Database.Database, weekStart: string): AvailabilitySummary {
  const memberCount = Number((conn.prepare(
    "SELECT COUNT(*) AS count FROM members WHERE status='active'",
  ).get() as { count: number | bigint }).count);
  const respondedCount = Number((conn.prepare(`SELECT COUNT(*) AS count
    FROM availability_responses ar
    JOIN members m ON m.id=ar.member_id
    WHERE m.status='active' AND ar.week_start=?`).get(weekStart) as { count: number | bigint }).count);
  const unavailableNames = (conn.prepare(`SELECT m.name
    FROM availability_responses ar
    JOIN members m ON m.id=ar.member_id
    WHERE m.status='active' AND ar.week_start=? AND ar.unavailable=1
    ORDER BY m.name`).all(weekStart) as Array<{ name: string }>).map(({ name }) => name);
  const rows = conn.prepare(`SELECT wa.day_of_week AS day,wa.hour,m.name
    FROM weekly_availability wa
    JOIN members m ON m.id=wa.member_id
    JOIN availability_responses ar ON ar.member_id=wa.member_id
    WHERE m.status='active' AND ar.week_start=? AND ar.unavailable=0 AND wa.hour>=10
    ORDER BY wa.day_of_week,wa.hour,m.name`).all(weekStart) as Array<AvailabilitySlot & { name: string }>;

  const slots: AvailabilitySummarySlot[] = [];
  for (const row of rows) {
    const current = slots.at(-1);
    if (!current || current.day !== row.day || current.hour !== row.hour) {
      slots.push({ day: row.day, hour: row.hour, count: 1, names: [row.name] });
    } else {
      current.count += 1;
      current.names.push(row.name);
    }
  }
  return {
    memberCount,
    respondedCount,
    unavailableCount: unavailableNames.length,
    unavailableNames,
    slots,
  };
}
