import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

describe('on-disk database (the path `npm run dev` uses)', () => {
  it('boots from a clean checkout where the data folder does not exist yet, and survives a restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glp-'));
    const dir = join(root, 'does', 'not', 'exist', 'pglite');
    try {
      const a = await createDb({ pgliteDir: dir });
      expect(await migrate(a)).toEqual(['001_init.sql']);
      await seed(a);
      await a.query(`INSERT INTO leads (application_id,name,mobile,gross_weight_mg,net_weight_mg,karat,scheme_id,rate_24k_paise_per_g,pure_gold_mg,gold_value_paise,eligible_loan_rupees)
                     VALUES ('GL-X','A B','9000000001',2000,1000,22,'PLAN_EMI_01',700000,917,642,4)`);
      await a.close();
      expect(existsSync(dir)).toBe(true);

      const b = await createDb({ pgliteDir: dir }); // restart: migrations are idempotent, data persists
      expect(await migrate(b)).toEqual([]);
      await seed(b);
      expect((await b.query('SELECT count(*)::int AS c FROM leads')).rows[0].c).toBe(1);
      expect((await b.query('SELECT count(*)::int AS c FROM loan_schemes')).rows[0].c).toBe(2);
      await b.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
