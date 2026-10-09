import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyFlow } from './ApplyFlow';

const SCHEMES = {
  data: [
    { id: 'PLAN_BULLET_01', name: 'Bullet Repayment', description: '', repaymentType: 'BULLET', annualInterestRate: 12, tenureMonths: 12, maxLtvPercent: 70 },
    { id: 'PLAN_EMI_01', name: 'Monthly EMI', description: '', repaymentType: 'EMI', annualInterestRate: 10.5, tenureMonths: 12, maxLtvPercent: 75 },
  ],
};
const QUOTE = {
  karat: 22,
  netWeightGrams: '45.000',
  pureGoldGrams: '41.250',
  goldValueRupees: '288750.00',
  plans: [
    { planId: 'PLAN_BULLET_01', planName: 'Bullet Repayment', repaymentType: 'BULLET', annualInterestRate: 12, tenureMonths: 12, maxLtvPercent: 70, appliedLtvPercent: 70, eligibleLoanRupees: 202125, totalInterestRupees: 24255, totalRepayableRupees: 226380 },
    { planId: 'PLAN_EMI_01', planName: 'Monthly EMI', repaymentType: 'EMI', annualInterestRate: 10.5, tenureMonths: 12, maxLtvPercent: 75, appliedLtvPercent: 75, eligibleLoanRupees: 216562, monthlyInstalmentRupees: 19090, totalInterestRupees: 12518, totalRepayableRupees: 229080 },
  ],
};
const LEAD = { applicationId: 'GL-1042', name: 'Ravi Kumar', mobileNumber: '9876XXXX10', planName: 'Monthly EMI', eligibleLoanRupees: 216562 };

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let calls: Array<{ url: string; body?: any }> = [];
let leadResponse: () => Promise<Response>;

beforeEach(() => {
  calls = [];
  leadResponse = () => json(201, LEAD);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/loan-schemes')) return json(200, SCHEMES);
      if (url.endsWith('/quotes')) return json(200, QUOTE);
      if (url.endsWith('/leads')) return leadResponse();
      return json(404, { error: { code: 'NOT_FOUND', message: 'nope', fields: [] } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const quoteCalls = () => calls.filter((c) => c.url.endsWith('/quotes')).length;

function fillDetails() {
  type('Full name', 'Ravi Kumar');
  type('Mobile number', '9876543210');
  type('Gross weight (g)', '50');
  type('Net weight (g)', '45');
  type('Karat', '22');
}

describe('inline validation as you type', () => {
  it('shows field errors immediately and blocks Next', () => {
    render(<ApplyFlow />);
    type('Mobile number', '5876543210');
    expect(screen.getByText(/starting with 6, 7, 8 or 9/)).toBeTruthy();
    type('Gross weight (g)', '50');
    type('Net weight (g)', '52');
    expect(screen.getByText('Net weight cannot be more than gross weight')).toBeTruthy();
    fireEvent.click(screen.getByText('See my quote'));
    expect(screen.queryByText('Choose your plan')).toBeNull();
    expect(screen.getByText('Name is required')).toBeTruthy();
  });

  it('uses numeric keypads on phones', () => {
    render(<ApplyFlow />);
    expect(screen.getByLabelText('Mobile number').getAttribute('inputmode')).toBe('numeric');
    expect(screen.getByLabelText('Net weight (g)').getAttribute('inputmode')).toBe('decimal');
    expect(screen.getByLabelText('Gross weight (g)').getAttribute('inputmode')).toBe('decimal');
  });
});

describe('quote, plan choice and submit', () => {
  it('debounces /quotes: rapid typing results in a single request', async () => {
    render(<ApplyFlow />);
    type('Gross weight (g)', '50');
    type('Karat', '22');
    for (const v of ['4', '45', '45.']) type('Net weight (g)', v); // '45.' is invalid -> no request
    type('Net weight (g)', '45');
    expect(quoteCalls()).toBe(0); // nothing fires before the 300 ms pause
    await waitFor(() => expect(quoteCalls()).toBe(1), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 450));
    expect(quoteCalls()).toBe(1);
  });

  it('full flow: details -> live quote cards -> confirm -> success with Application ID', async () => {
    render(<ApplyFlow />);
    fillDetails();
    await screen.findByText(/loan up to/);
    fireEvent.click(screen.getByText('See my quote'));

    expect(await screen.findByText('Choose your plan')).toBeTruthy();
    await screen.findByText('₹2,16,562');
    expect(screen.getByText('₹2,02,125')).toBeTruthy();
    expect(screen.getByText('41.250 g')).toBeTruthy();

    const emi = screen.getByRole('radio', { name: /Monthly EMI/ });
    expect(emi.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(emi);
    expect(emi.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /Bullet/ }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByText('Review application'));
    expect(await screen.findByText('Review and confirm')).toBeTruthy();
    expect(screen.getByText('9876XXXX10')).toBeTruthy(); // never shows the full number
    fireEvent.click(screen.getByText('Submit application'));

    expect((await screen.findByTestId('application-id')).textContent).toBe('GL-1042');
    const sent = calls.find((c) => c.url.endsWith('/leads'))!.body;
    expect(sent).toEqual({ name: 'Ravi Kumar', mobileNumber: '9876543210', grossWeightGrams: 50, netWeightGrams: 45, karat: 22, planId: 'PLAN_EMI_01' });
    expect(Object.keys(sent)).not.toContain('eligibleLoanRupees'); // the client never sends money figures
  });

  it('a 409 becomes a friendly sentence, not "Error 409"', async () => {
    leadResponse = () =>
      json(409, {
        error: {
          code: 'DUPLICATE_APPLICATION',
          message: 'raw server text',
          fields: [],
          details: { applicationId: 'GL-1042', appliedAt: '2026-10-03T08:00:00.000Z' },
        },
      });
    render(<ApplyFlow />);
    fillDetails();
    await screen.findByText(/loan up to/);
    fireEvent.click(screen.getByText('See my quote'));
    await screen.findByText('₹2,16,562');
    fireEvent.click(screen.getByRole('radio', { name: /Monthly EMI/ }));
    fireEvent.click(screen.getByText('Review application'));
    fireEvent.click(await screen.findByText('Submit application'));

    const alert = await screen.findByText(/You already applied on 3 Oct, application GL-1042/);
    expect(alert).toBeTruthy();
    expect(document.body.textContent).not.toContain('Error 409');
  });

  it('a 400 from the API lands inline on the right field and returns to step 1', async () => {
    leadResponse = () =>
      json(400, { error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', fields: [{ field: 'mobileNumber', message: 'Server says the mobile is bad' }] } });
    render(<ApplyFlow />);
    fillDetails();
    await screen.findByText(/loan up to/);
    fireEvent.click(screen.getByText('See my quote'));
    await screen.findByText('₹2,16,562');
    fireEvent.click(screen.getByRole('radio', { name: /Monthly EMI/ }));
    fireEvent.click(screen.getByText('Review application'));
    fireEvent.click(await screen.findByText('Submit application'));
    expect(await screen.findByText('Server says the mobile is bad')).toBeTruthy();
    expect(screen.getByLabelText('Mobile number').getAttribute('aria-invalid')).toBe('true');
  });
});
