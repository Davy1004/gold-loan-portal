import { config } from '../config.js';
import { createDb } from './index.js';
import { migrate } from './migrate.js';

const db = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
const ran = await migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Nothing to migrate.');
await db.close();
