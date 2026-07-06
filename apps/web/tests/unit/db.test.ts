import { describe, expect, it } from 'vitest';
import { getDb, listMaterials, listMembers, resolveDbPath } from '@/lib/db';

describe('SQLite adapter', () => {
  it('resolves the default DB path to the retained Flask database', () => {
    expect(resolveDbPath()).toMatch(/backend\/lab-feed\.db$/);
  });

  it('opens the existing database read-only by default', () => {
    const db = getDb();
    const row = db.prepare("select name from sqlite_master where type='table' and name='materials'").get() as { name?: string } | undefined;
    expect(row?.name).toBe('materials');
  });

  it('lists existing members without exposing credential columns', () => {
    const members = listMembers();
    expect(members.length).toBeGreaterThan(0);
    expect(members[0]).toHaveProperty('id');
    expect(members[0]).toHaveProperty('name');
    expect(members[0]).not.toHaveProperty('password_hash');
    expect(members[0]).not.toHaveProperty('api_key');
  });

  it('lists materials with markdown source body preserved', () => {
    const materials = listMaterials();
    expect(Array.isArray(materials)).toBe(true);
    if (materials.length > 0) {
      expect(materials[0]).toHaveProperty('title');
      expect(materials[0]).toHaveProperty('body');
    }
  });
});
