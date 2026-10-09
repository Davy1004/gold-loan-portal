import { config } from '../config.js';
import { createDb, type Db } from './index.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

/** Open the configured DB, migrate and seed. Used by the server, CLI scripts and evals. */
export async function bootDb(opts?: { inMemory?: boolean; databaseUrl?: string }): Promise<Db> {
  const db = await createDb({
    databaseUrl: opts?.databaseUrl ?? (opts?.inMemory ? undefined : config.databaseUrl),
    pgliteDir: opts?.inMemory ? undefined : config.pgliteDir,
  });
  await migrate(db);
  await seed(db);
  return db;
}
