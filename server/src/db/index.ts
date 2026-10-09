import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Queryable {
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

/**
 * DATABASE_URL set  -> real PostgreSQL via `pg`.
 * otherwise         -> PGlite: the real Postgres engine compiled to WASM, running in-process.
 *                      Same SQL, same migrations. Lets `npm run dev` and `npm test` work with zero setup.
 */
export async function createDb(opts: { databaseUrl?: string; pgliteDir?: string }): Promise<Db> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params as any[]) as any,
      exec: async (sql) => {
        await pool.query(sql);
      },
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (sql, params) => client.query(sql, params as any[]) as any });
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  // PGlite does not create missing parent folders, so a fresh clone would crash on first boot without this.
  if (opts.pgliteDir) mkdirSync(dirname(opts.pgliteDir), { recursive: true });
  const lite = new PGlite(opts.pgliteDir); // undefined dir => in-memory
  await lite.waitReady;
  return {
    kind: 'pglite',
    query: (sql, params) => lite.query(sql, params as any[]) as any,
    exec: async (sql) => {
      await lite.exec(sql);
    },
    tx: (fn) => lite.transaction((t) => fn({ query: (sql, params) => t.query(sql, params as any[]) as any })),
    close: () => lite.close(),
  };
}
