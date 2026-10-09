import { createHash } from 'node:crypto';
import { DUPLICATE_WINDOW_DAYS, RATE_24K_RUPEES_PER_GRAM } from '../config.js';
import { gramsToMg, mgToGramsString, paiseToRupeesString } from '../domain/money.js';
import type { Db, Queryable } from '../db/index.js';
import type { LeadInput } from '../domain/schemas.js';
import { AppError } from '../errors.js';
import { logger, maskMobile } from '../logger.js';
import { computeForScheme } from './quotes.js';
import { getScheme } from './schemes.js';

export interface Lead {
  applicationId: string;
  name: string;
  mobileNumber: string; // ALWAYS masked
  grossWeightGrams: string;
  netWeightGrams: string;
  karat: number;
  planId: string;
  planName: string;
  pureGoldGrams: string;
  goldValueRupees: string;
  eligibleLoanRupees: number;
  status: string;
  source: 'FORM' | 'AGENT';
  createdAt: string;
}

const mapLead = (r: any): Lead => ({
  applicationId: r.application_id,
  name: r.name,
  mobileNumber: maskMobile(r.mobile),
  grossWeightGrams: mgToGramsString(BigInt(r.gross_weight_mg)),
  netWeightGrams: mgToGramsString(BigInt(r.net_weight_mg)),
  karat: Number(r.karat),
  planId: r.scheme_id,
  planName: r.scheme_name,
  pureGoldGrams: mgToGramsString(BigInt(r.pure_gold_mg)),
  goldValueRupees: paiseToRupeesString(BigInt(r.gold_value_paise)),
  eligibleLoanRupees: Number(r.eligible_loan_rupees),
  status: r.status,
  source: r.source,
  createdAt: new Date(r.created_at).toISOString(),
});

const SELECT = `SELECT l.*, s.name AS scheme_name FROM leads l JOIN loan_schemes s ON s.id = l.scheme_id`;

export interface DuplicateInfo {
  applicationId: string;
  appliedAt: string;
}

/** Most recent application from this mobile inside the 7-day window, if any. Read-only. */
export async function findRecentApplication(q: Queryable, mobile: string): Promise<DuplicateInfo | null> {
  const { rows } = await q.query(
    `SELECT application_id, created_at FROM leads
     WHERE mobile = $1 AND created_at > now() - ($2 || ' days')::interval
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [mobile, String(DUPLICATE_WINDOW_DAYS)],
  );
  return rows[0] ? { applicationId: rows[0].application_id, appliedAt: new Date(rows[0].created_at).toISOString() } : null;
}

export function duplicateError(d: DuplicateInfo): AppError {
  const date = new Date(d.appliedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return new AppError(
    409,
    'DUPLICATE_APPLICATION',
    `This mobile number already applied on ${date} (application ${d.applicationId}). Please try again after ${DUPLICATE_WINDOW_DAYS} days.`,
    [{ field: 'mobileNumber', message: 'Already applied in the last 7 days' }],
    { applicationId: d.applicationId, appliedAt: d.appliedAt },
  );
}

export interface CreateResult {
  status: 201;
  lead: Lead;
  replayed: boolean;
}

const hashBody = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

/**
 * The ONE place a lead is created. The REST route and the AI agent both call this.
 * - Recomputes every number server-side; client/LLM-supplied amounts never reach this function.
 * - Concurrency-safe: advisory locks serialise same-mobile (and same-key) requests, so two parallel
 *   requests can never both pass the duplicate check.
 * - Idempotency-Key: same key + same body replays the original 201; same key + different body is a 422.
 */
export async function createLead(
  db: Db,
  input: LeadInput,
  opts: { source?: 'FORM' | 'AGENT'; idempotencyKey?: string } = {},
): Promise<CreateResult> {
  const source = opts.source ?? 'FORM';
  const key = opts.idempotencyKey?.trim() || undefined;
  const reqHash = hashBody({ ...input, source });

  return db.tx(async (q) => {
    // Lock order is always key -> mobile, so concurrent requests cannot deadlock.
    if (key) {
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`idem:${key}`]);
      const { rows } = await q.query('SELECT request_hash, response FROM idempotency_keys WHERE key = $1', [key]);
      if (rows[0]) {
        if (rows[0].request_hash !== reqHash) {
          throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
        }
        return { status: 201 as const, lead: rows[0].response as Lead, replayed: true };
      }
    }
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mobile:${input.mobileNumber}`]);

    const scheme = await getScheme(q, input.planId); // 404 if unknown
    const dup = await findRecentApplication(q, input.mobileNumber);
    if (dup) throw duplicateError(dup);

    const calc = computeForScheme(input, scheme);
    const seq = await q.query<{ n: string }>(`SELECT nextval('lead_application_seq')::text AS n`);
    const applicationId = `GL-${seq.rows[0].n}`;

    await q.query(
      `INSERT INTO leads (application_id, name, mobile, gross_weight_mg, net_weight_mg, karat, scheme_id,
         rate_24k_paise_per_g, pure_gold_mg, gold_value_paise, eligible_loan_rupees, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SUBMITTED',$12)`,
      [
        applicationId,
        input.name,
        input.mobileNumber,
        gramsToMg(input.grossWeightGrams).toString(),
        gramsToMg(input.netWeightGrams).toString(),
        input.karat,
        scheme.id,
        (BigInt(RATE_24K_RUPEES_PER_GRAM) * 100n).toString(),
        calc.pureGoldMg.toString(),
        calc.goldValuePaise.toString(),
        calc.eligibleLoanRupees.toString(),
        source,
      ],
    );
    const { rows } = await q.query(`${SELECT} WHERE l.application_id = $1`, [applicationId]);
    const lead = mapLead(rows[0]);

    if (key) {
      await q.query('INSERT INTO idempotency_keys (key, request_hash, status_code, response) VALUES ($1,$2,201,$3)', [
        key,
        reqHash,
        JSON.stringify(lead),
      ]);
    }
    logger.info(`lead created ${applicationId} mobile=${input.mobileNumber} source=${source} loan=${lead.eligibleLoanRupees}`);
    return { status: 201 as const, lead, replayed: false };
  });
}

export interface ListLeadsParams {
  page: number;
  pageSize: number;
  planId?: string;
  status?: string;
}

export async function listLeads(q: Queryable, p: ListLeadsParams) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.planId) {
    args.push(p.planId);
    where.push(`l.scheme_id = $${args.length}`);
  }
  if (p.status) {
    args.push(p.status);
    where.push(`l.status = $${args.length}`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(
    (await q.query<{ c: string }>(`SELECT count(*)::text AS c FROM leads l ${w}`, args)).rows[0].c,
  );
  const rows = (
    await q.query(`${SELECT} ${w} ORDER BY l.created_at DESC, l.id DESC LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, args)
  ).rows;
  return { data: rows.map(mapLead), page: p.page, pageSize: p.pageSize, total };
}
