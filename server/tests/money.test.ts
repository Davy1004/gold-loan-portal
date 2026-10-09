import { describe, expect, it } from 'vitest';
import { calculate, formatRupees, gramsToMg, mgToGramsString, paiseToRupeesString, repayment } from '../src/domain/money.js';

const RATE = 700000n; // Rs 7,000/g in paise
const run = (net: number, karat: 18 | 22 | 24, ltv: number) =>
  calculate({ netWeightMg: gramsToMg(net), karat, rate24kPaisePerGram: RATE, maxLtvBps: ltv });

describe('exact gold-loan maths (brief test cases)', () => {
  it('45 g, 22K, EMI plan (75%) -> pure 41.25 g, value 2,88,750, loan 2,16,562', () => {
    const r = run(45, 22, 7500);
    expect(mgToGramsString(r.pureGoldMg)).toBe('41.250');
    expect(paiseToRupeesString(r.goldValuePaise)).toBe('288750.00');
    expect(r.eligibleLoanRupees).toBe(216562n); // 216,562.5 floored, never rounded up
  });

  it('45 g, 22K, Bullet plan (70%) -> loan 2,02,125', () => {
    const r = run(45, 22, 7000);
    expect(paiseToRupeesString(r.goldValuePaise)).toBe('288750.00');
    expect(r.eligibleLoanRupees).toBe(202125n);
  });

  it('10 g, 18K, EMI plan -> pure 7.5 g, value 52,500, loan 39,375', () => {
    const r = run(10, 18, 7500);
    expect(mgToGramsString(r.pureGoldMg)).toBe('7.500');
    expect(paiseToRupeesString(r.goldValuePaise)).toBe('52500.00');
    expect(r.eligibleLoanRupees).toBe(39375n);
  });
});

describe('money edge cases', () => {
  it('caps LTV at 75% even if a plan is configured higher', () => {
    expect(run(45, 22, 9000).eligibleLoanRupees).toBe(216562n);
    expect(run(45, 22, 9000).appliedLtvBps).toBe(7500);
  });

  it('floors, never rounds up: 1 g, 24K at 75% = 5,250 exactly; 0.001 g gives 5 (5.25 floored)', () => {
    expect(run(1, 24, 7500).eligibleLoanRupees).toBe(5250n);
    expect(run(0.001, 24, 7500).eligibleLoanRupees).toBe(5n);
  });

  it('is exact where floating point is not (repeating 22/24 fraction)', () => {
    // 33.333 g * 22/24 * 7000 * 0.75 = 160,415.0625 exactly -> 160415
    expect(run(33.333, 22, 7500).eligibleLoanRupees).toBe(160415n);
    // classic float trap: 0.1 + 0.2 style input must not drift
    expect(gramsToMg(0.3)).toBe(300n);
    expect(gramsToMg(1.005)).toBe(1005n);
  });

  it('rejects sub-milligram precision', () => {
    expect(() => gramsToMg(1.0005)).toThrow();
  });

  it('formats Indian digit grouping', () => {
    expect(formatRupees(216562)).toBe('₹2,16,562');
    expect(formatRupees(288750)).toBe('₹2,88,750');
  });
});

describe('repayment figures', () => {
  it('EMI on 2,16,562 at 10.5% for 12 months is about 19,100/month', () => {
    const r = repayment('EMI', 216562n, 10.5, 12);
    expect(r.monthlyInstalmentRupees).toBeGreaterThan(19000);
    expect(r.monthlyInstalmentRupees).toBeLessThan(19300);
    expect(r.totalRepayableRupees).toBe(r.monthlyInstalmentRupees! * 12);
  });
  it('Bullet on 2,02,125 at 12% for 12 months = principal + 24,255', () => {
    const r = repayment('BULLET', 202125n, 12, 12);
    expect(r.totalInterestRupees).toBe(24255);
    expect(r.totalRepayableRupees).toBe(226380);
  });
});
