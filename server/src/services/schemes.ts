import type { Queryable } from '../db/index.js';
import { AppError } from '../errors.js';

export interface Scheme {
  id: string;
  name: string;
  description: string;
  repaymentType: 'BULLET' | 'EMI';
  annualInterestRate: number;
  tenureMonths: number;
  maxLtvBps: number;
  maxLtvPercent: number;
}

const map = (r: any): Scheme => ({
  id: r.id,
  name: r.name,
  description: r.description,
  repaymentType: r.repayment_type,
  annualInterestRate: Number(r.annual_interest_rate),
  tenureMonths: Number(r.tenure_months),
  maxLtvBps: Number(r.max_ltv_bps),
  maxLtvPercent: Number(r.max_ltv_bps) / 100,
});

export async function listSchemes(q: Queryable): Promise<Scheme[]> {
  const { rows } = await q.query('SELECT * FROM loan_schemes WHERE active ORDER BY id');
  return rows.map(map);
}

export async function getScheme(q: Queryable, id: string): Promise<Scheme> {
  const { rows } = await q.query('SELECT * FROM loan_schemes WHERE id = $1 AND active', [id]);
  if (!rows[0]) throw new AppError(404, 'PLAN_NOT_FOUND', `Loan plan "${id}" does not exist`, [{ field: 'planId', message: 'Unknown plan' }]);
  return map(rows[0]);
}
