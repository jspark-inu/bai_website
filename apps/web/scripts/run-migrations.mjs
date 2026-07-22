import { runMigrations } from '../src/lib/db/migrations.ts';

try {
  const applied = runMigrations();
  console.log(`Migrations applied: ${applied.length}${applied.length ? ` (${applied.join(', ')})` : ''}`);
} catch (error) {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
