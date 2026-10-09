import request from 'supertest';
import { bootDb } from '../src/db/boot.js';
import type { Db } from '../src/db/index.js';
import { createApp } from '../src/http/app.js';

export async function makeApp() {
  // TEST_DATABASE_URL -> run the same suite against a real PostgreSQL server (exercises the `pg` driver
  // and real advisory-lock concurrency). Otherwise an in-memory PGlite database is used.
  const url = process.env.TEST_DATABASE_URL;
  const db: Db = await bootDb({ inMemory: true, databaseUrl: url });
  if (url) await db.exec('TRUNCATE leads, idempotency_keys RESTART IDENTITY');
  const app = createApp({ db });
  return { db, app, http: request(app) };
}

let n = 0;
/** A unique valid mobile per call so tests never collide on the 7-day rule. */
export function freshMobile(): string {
  n += 1;
  return `9${String(100000000 + n).padStart(9, '0')}`;
}

export const validLead = (over: Record<string, unknown> = {}) => ({
  name: 'Ravi Kumar',
  mobileNumber: freshMobile(),
  grossWeightGrams: 50,
  netWeightGrams: 45,
  karat: 22,
  planId: 'PLAN_EMI_01',
  ...over,
});
