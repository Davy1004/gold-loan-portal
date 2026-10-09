/**
 * Exact money maths with BigInt. No floating-point rupees anywhere.
 *
 * Units:  weights -> integer milligrams, 24K rate -> integer paise per gram,
 *         LTV -> basis points (7500 = 75%), value -> integer paise, loan -> integer rupees.
 *
 * pureGold  = net * karat / 24
 * goldValue = pureGold * rate24k
 * loan      = floor( goldValue * min(plan.maxLtv, 0.75) )   computed from the EXACT rational,
 *             not from an already-rounded value, so rounding can never push a loan up.
 */
import { MAX_LTV_BPS } from '../config.js';

export interface CalcInput {
  netWeightMg: bigint;
  karat: 18 | 22 | 24;
  rate24kPaisePerGram: bigint;
  maxLtvBps: number;
}

export interface CalcResult {
  pureGoldMg: bigint; // rounded half-up, for display
  goldValuePaise: bigint; // floored to a whole paisa
  eligibleLoanRupees: bigint; // floored to whole rupees
  appliedLtvBps: number;
}

const bi = (n: number) => BigInt(n);

function divRoundHalfUp(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

export function calculate(input: CalcInput): CalcResult {
  const { netWeightMg, karat, rate24kPaisePerGram, maxLtvBps } = input;
  const ltv = bi(Math.min(maxLtvBps, MAX_LTV_BPS));
  const k = bi(karat);

  const pureGoldMg = divRoundHalfUp(netWeightMg * k, 24n);
  // paise = mg * karat/24 * (paise/g) / 1000 mg/g
  const goldValuePaise = (netWeightMg * k * rate24kPaisePerGram) / (24n * 1000n);
  // rupees = paise / 100, ltv = bps / 10000  -> all in one division so we floor exactly once
  const eligibleLoanRupees = (netWeightMg * k * rate24kPaisePerGram * ltv) / (24n * 1000n * 100n * 10000n);

  return { pureGoldMg, goldValuePaise, eligibleLoanRupees, appliedLtvBps: Number(ltv) };
}

/** Grams (JS number with <= 3 decimals) -> integer milligrams. Throws if more precision than 1 mg. */
export function gramsToMg(g: number): bigint {
  const mg = Math.round(g * 1000);
  if (Math.abs(g * 1000 - mg) > 1e-6) throw new Error('weight has more than 3 decimal places');
  return BigInt(mg);
}

/** Integer milligrams -> "41.250" style decimal string (always 3 dp). */
export function mgToGramsString(mg: bigint): string {
  const neg = mg < 0n;
  const abs = neg ? -mg : mg;
  return `${neg ? '-' : ''}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
}

/** Integer paise -> "288750.00" */
export function paiseToRupeesString(p: bigint): string {
  return `${p / 100n}.${(p % 100n).toString().padStart(2, '0')}`;
}

/** Whole rupees -> Indian grouping, e.g. 216562 -> "₹2,16,562" */
export function formatRupees(r: number | bigint): string {
  return '₹' + Number(r).toLocaleString('en-IN');
}

/**
 * Repayment figures shown to the borrower (informational; the loan amount above is what is stored).
 * EMI  = P*r*(1+r)^n / ((1+r)^n - 1), r = annual/12/100. BigInt fixed-point, rounded half-up to whole rupees.
 * Bullet = principal + simple interest for the tenure.
 */
export function repayment(
  type: 'BULLET' | 'EMI',
  principalRupees: bigint,
  annualRatePct: number,
  tenureMonths: number,
): { monthlyInstalmentRupees?: number; totalRepayableRupees: number; totalInterestRupees: number } {
  const rateBp = BigInt(Math.round(annualRatePct * 100)); // 10.5% -> 1050 bp
  if (type === 'BULLET') {
    // interest = P * rate * months / 12  (rate in bp)
    const interest = divRoundHalfUp(principalRupees * rateBp * bi(tenureMonths), 12n * 10000n);
    return {
      totalRepayableRupees: Number(principalRupees + interest),
      totalInterestRupees: Number(interest),
    };
  }
  // EMI in fixed-point with 1e12 scale
  const S = 10n ** 12n;
  const r = (rateBp * S) / (12n * 10000n); // monthly rate scaled
  let pow = S; // (1+r)^n scaled
  for (let i = 0; i < tenureMonths; i++) pow = (pow * (S + r)) / S;
  const emiRounded = divRoundHalfUp(principalRupees * r * pow, (pow - S) * S);
  const total = emiRounded * bi(tenureMonths);
  return {
    monthlyInstalmentRupees: Number(emiRounded),
    totalRepayableRupees: Number(total),
    totalInterestRupees: Number(total - principalRupees),
  };
}
