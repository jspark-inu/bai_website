import type Database from 'better-sqlite3';

export type AvailabilitySlot = { day: number; hour: number };
export type AvailabilitySummarySlot = AvailabilitySlot & { count: number; names: string[] };
export type AvailabilitySummary = {
  memberCount: number;
  respondedCount: number;
  slots: AvailabilitySummarySlot[];
};

export function readAvailabilityForMember(
  conn: Database.Database,
  memberId: number,
): AvailabilitySlot[] {
  return conn.prepare(`SELECT day_of_week AS day,hour
    FROM weekly_availability
    WHERE member_id=?
    ORDER BY day_of_week,hour`).all(memberId) as AvailabilitySlot[];
}

export function replaceAvailabilityInTransaction(
  conn: Database.Database,
  memberId: number,
  slots: readonly AvailabilitySlot[],
): boolean {
  const active = conn.prepare("SELECT 1 FROM members WHERE id=? AND status='active'").get(memberId);
  if (!active) return false;

  conn.prepare('DELETE FROM weekly_availability WHERE member_id=?').run(memberId);
  const insert = conn.prepare(`INSERT INTO weekly_availability
    (member_id,day_of_week,hour,updated_at) VALUES (?,?,?,datetime('now'))`);
  for (const slot of slots) insert.run(memberId, slot.day, slot.hour);
  return true;
}

export function readAvailabilitySummary(conn: Database.Database): AvailabilitySummary {
  const memberCount = Number((conn.prepare(
    "SELECT COUNT(*) AS count FROM members WHERE status='active'",
  ).get() as { count: number | bigint }).count);
  const respondedCount = Number((conn.prepare(`SELECT COUNT(DISTINCT wa.member_id) AS count
    FROM weekly_availability wa
    JOIN members m ON m.id=wa.member_id
    WHERE m.status='active'`).get() as { count: number | bigint }).count);
  const rows = conn.prepare(`SELECT wa.day_of_week AS day,wa.hour,m.name
    FROM weekly_availability wa
    JOIN members m ON m.id=wa.member_id
    WHERE m.status='active'
    ORDER BY wa.day_of_week,wa.hour,m.name`).all() as Array<AvailabilitySlot & { name: string }>;

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
  return { memberCount, respondedCount, slots };
}
