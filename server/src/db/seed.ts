import type { Db } from './index.js';

export const SEED_SCHEMES = [
  {
    id: 'PLAN_BULLET_01',
    name: 'Bullet Repayment',
    description: '12 months, interest + principal paid at maturity',
    repayment_type: 'BULLET',
    annual_interest_rate: 12.0,
    tenure_months: 12,
    max_ltv_bps: 7000,
  },
  {
    id: 'PLAN_EMI_01',
    name: 'Monthly EMI',
    description: '12 months, equal monthly instalments',
    repayment_type: 'EMI',
    annual_interest_rate: 10.5,
    tenure_months: 12,
    max_ltv_bps: 7500,
  },
] as const;

/** Idempotent: safe to run on every boot. */
export async function seed(db: Db): Promise<void> {
  for (const s of SEED_SCHEMES) {
    await db.query(
      `INSERT INTO loan_schemes (id, name, description, repayment_type, annual_interest_rate, tenure_months, max_ltv_bps, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
         repayment_type=EXCLUDED.repayment_type, annual_interest_rate=EXCLUDED.annual_interest_rate,
         tenure_months=EXCLUDED.tenure_months, max_ltv_bps=EXCLUDED.max_ltv_bps`,
      [s.id, s.name, s.description, s.repayment_type, s.annual_interest_rate, s.tenure_months, s.max_ltv_bps],
    );
  }
}
