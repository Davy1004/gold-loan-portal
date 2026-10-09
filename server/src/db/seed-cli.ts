import { config } from '../config.js';
import { createDb } from './index.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

const db = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
await migrate(db);
await seed(db);
console.log('Seeded loan schemes.');
await db.close();
