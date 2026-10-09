import { RATE_24K_RUPEES_PER_GRAM } from '../config.js';
import {
  calculate,
  gramsToMg,
  mgToGramsString,
  paiseToRupeesString,
  repayment,
} from '../domain/money.js';
import type { Queryable } from '../db/index.js';
import type { QuoteInput } from '../domain/schemas.js';
import { getScheme, listSchemes, type Scheme } from './schemes.js';

export interface PlanQuote {
  planId: string;
  planName: string;
  repaymentType: 'BULLET' | 'EMI';
  annualInterestRate: number;
  tenureMonths: number;
  maxLtvPercent: number;
  appliedLtvPercent: number;
  eligibleLoanRupees: number;
  monthlyInstalmentRupees?: number;
  totalInterestRupees: number;
  totalRepayableRupees: number;
}

export interface Quote {
  rate24kPerGram: number;
  karat: number;
  netWeightGrams: string;
  pureGoldGrams: string;
  goldValuePaise: number;
  goldValueRupees: string;
  plans: PlanQuote[];
}

export function computeForScheme(input: { netWeightGrams: number; karat: 18 | 22 | 24 }, scheme: Scheme) {
  const calc = calculate({
    netWeightMg: gramsToMg(input.netWeightGrams),
    karat: input.karat,
    rate24kPaisePerGram: BigInt(RATE_24K_RUPEES_PER_GRAM) * 100n,
    maxLtvBps: scheme.maxLtvBps,
  });
  return calc;
}

/** Pure calculation: reads plans, writes nothing. Used by POST /quotes, POST /leads and the agent. */
export async function calculateQuote(q: Queryable, input: QuoteInput): Promise<Quote> {
  const schemes = input.planId ? [await getScheme(q, input.planId)] : await listSchemes(q);
  const mg = gramsToMg(input.netWeightGrams);
  let pureGoldMg = 0n;
  let goldValuePaise = 0n;

  const plans: PlanQuote[] = schemes.map((s) => {
    const c = computeForScheme(input, s);
    pureGoldMg = c.pureGoldMg;
    goldValuePaise = c.goldValuePaise;
    const rep = repayment(s.repaymentType, c.eligibleLoanRupees, s.annualInterestRate, s.tenureMonths);
    return {
      planId: s.id,
      planName: s.name,
      repaymentType: s.repaymentType,
      annualInterestRate: s.annualInterestRate,
      tenureMonths: s.tenureMonths,
      maxLtvPercent: s.maxLtvPercent,
      appliedLtvPercent: c.appliedLtvBps / 100,
      eligibleLoanRupees: Number(c.eligibleLoanRupees),
      ...(rep.monthlyInstalmentRupees !== undefined ? { monthlyInstalmentRupees: rep.monthlyInstalmentRupees } : {}),
      totalInterestRupees: rep.totalInterestRupees,
      totalRepayableRupees: rep.totalRepayableRupees,
    };
  });

  return {
    rate24kPerGram: RATE_24K_RUPEES_PER_GRAM,
    karat: input.karat,
    netWeightGrams: mgToGramsString(mg),
    pureGoldGrams: mgToGramsString(pureGoldMg),
    goldValuePaise: Number(goldValuePaise),
    goldValueRupees: paiseToRupeesString(goldValuePaise),
    plans,
  };
}
