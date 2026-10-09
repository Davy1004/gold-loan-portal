import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshMobile, makeApp, validLead } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.db.close();
});

describe('GET /loan-schemes', () => {
  it('returns the two seeded plans, none above 75% LTV', async () => {
    const res = await ctx.http.get('/api/v1/loan-schemes').expect(200);
    const ids = res.body.data.map((p: any) => p.id).sort();
    expect(ids).toEqual(['PLAN_BULLET_01', 'PLAN_EMI_01']);
    const emi = res.body.data.find((p: any) => p.id === 'PLAN_EMI_01');
    expect(emi).toMatchObject({ name: 'Monthly EMI', annualInterestRate: 10.5, tenureMonths: 12, maxLtvPercent: 75 });
    for (const p of res.body.data) expect(p.maxLtvPercent).toBeLessThanOrEqual(75);
  });
});

describe('POST /quotes (pure calculation)', () => {
  it('case 1+2: 45 g 22K -> pure 41.25, value 2,88,750, EMI loan 2,16,562, Bullet loan 2,02,125', async () => {
    const res = await ctx.http
      .post('/api/v1/quotes')
      .send({ netWeightGrams: 45, grossWeightGrams: 50, karat: 22 })
      .expect(200);
    expect(res.body.pureGoldGrams).toBe('41.250');
    expect(res.body.goldValueRupees).toBe('288750.00');
    const loan = (id: string) => res.body.plans.find((p: any) => p.planId === id).eligibleLoanRupees;
    expect(loan('PLAN_EMI_01')).toBe(216562);
    expect(loan('PLAN_BULLET_01')).toBe(202125);
  });

  it('case 3: 10 g 18K -> pure 7.5, value 52,500, loan 39,375', async () => {
    const res = await ctx.http
      .post('/api/v1/quotes')
      .send({ netWeightGrams: 10, grossWeightGrams: 12, karat: 18, planId: 'PLAN_EMI_01' })
      .expect(200);
    expect(res.body.pureGoldGrams).toBe('7.500');
    expect(res.body.goldValueRupees).toBe('52500.00');
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.plans[0].eligibleLoanRupees).toBe(39375);
  });

  it('writes nothing to the database', async () => {
    const before = await ctx.db.query('SELECT count(*)::int AS c FROM leads');
    await ctx.http.post('/api/v1/quotes').send({ netWeightGrams: 5, grossWeightGrams: 6, karat: 24 }).expect(200);
    const after = await ctx.db.query('SELECT count(*)::int AS c FROM leads');
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it('case 4: net > gross -> 400 with a field error on netWeightGrams', async () => {
    const res = await ctx.http.post('/api/v1/quotes').send({ netWeightGrams: 52, grossWeightGrams: 50, karat: 22 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.map((f: any) => f.field)).toContain('netWeightGrams');
  });

  it('unknown plan -> 404', async () => {
    const res = await ctx.http
      .post('/api/v1/quotes')
      .send({ netWeightGrams: 5, grossWeightGrams: 6, karat: 22, planId: 'NOPE' })
      .expect(404);
    expect(res.body.error.code).toBe('PLAN_NOT_FOUND');
  });
});

describe('POST /leads validation (400)', () => {
  const bad = async (over: Record<string, unknown>, field: string) => {
    const res = await ctx.http.post('/api/v1/leads').send(validLead(over)).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.map((f: any) => f.field)).toContain(field);
    return res;
  };

  it('case 4: net 52 > gross 50 -> netWeightGrams', () => bad({ netWeightGrams: 52, grossWeightGrams: 50 }, 'netWeightGrams'));
  it('case 5a: mobile 5876543210 (starts with 5) -> mobileNumber', () => bad({ mobileNumber: '5876543210' }, 'mobileNumber'));
  it('case 5b: mobile 98765 (too short) -> mobileNumber', () => bad({ mobileNumber: '98765' }, 'mobileNumber'));
  it('name with digits -> name', () => bad({ name: 'Ravi 2' }, 'name'));
  it('name too short -> name', () => bad({ name: 'R' }, 'name'));
  it('name too long -> name', () => bad({ name: 'A'.repeat(61) }, 'name'));
  it('karat 20 -> karat', () => bad({ karat: 20 }, 'karat'));
  it('net 0 -> netWeightGrams', () => bad({ netWeightGrams: 0 }, 'netWeightGrams'));
  it('gross 1001 -> grossWeightGrams', () => bad({ grossWeightGrams: 1001, netWeightGrams: 10 }, 'grossWeightGrams'));
  it('weights sent as strings are rejected, not silently coerced', () => bad({ netWeightGrams: '45' }, 'netWeightGrams'));

  it('reports every bad field at once, in the standard error shape', async () => {
    const res = await ctx.http.post('/api/v1/leads').send({}).expect(400);
    const fields = res.body.error.fields.map((f: any) => f.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'mobileNumber', 'grossWeightGrams', 'netWeightGrams', 'karat', 'planId']));
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(Object.keys(res.body.error)).toEqual(['code', 'message', 'fields']);
  });

  it('unknown plan id -> 404 (not 400)', async () => {
    const res = await ctx.http.post('/api/v1/leads').send(validLead({ planId: 'PLAN_NOPE' })).expect(404);
    expect(res.body.error.code).toBe('PLAN_NOT_FOUND');
  });
});

describe('POST /leads happy path and duplicates', () => {
  it('case 1: creates the lead (201), recomputes server-side, ignores client-sent money', async () => {
    const res = await ctx.http
      .post('/api/v1/leads')
      .send(validLead({ eligibleLoanRupees: 9999999, goldValueRupees: '1', pureGoldGrams: '999', status: 'APPROVED' }))
      .expect(201);
    expect(res.body.applicationId).toMatch(/^GL-\d+$/);
    expect(res.body.eligibleLoanRupees).toBe(216562);
    expect(res.body.goldValueRupees).toBe('288750.00');
    expect(res.body.pureGoldGrams).toBe('41.250');
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.mobileNumber).toMatch(/^\d{4}XXXX\d{2}$/);
  });

  it('bullet plan uses its own 70% LTV', async () => {
    const res = await ctx.http.post('/api/v1/leads').send(validLead({ planId: 'PLAN_BULLET_01' })).expect(201);
    expect(res.body.eligibleLoanRupees).toBe(202125);
  });

  it('case 6: same mobile within 7 days -> 409 with the existing applicationId', async () => {
    const mobile = freshMobile();
    const first = await ctx.http.post('/api/v1/leads').send(validLead({ mobileNumber: mobile })).expect(201);
    const second = await ctx.http.post('/api/v1/leads').send(validLead({ mobileNumber: mobile, name: 'Someone Else' })).expect(409);
    expect(second.body.error.code).toBe('DUPLICATE_APPLICATION');
    expect(second.body.error.details.applicationId).toBe(first.body.applicationId);
    expect(second.body.error.message).toContain(first.body.applicationId);
  });

  it('allows the same mobile again once the earlier application is older than 7 days', async () => {
    const mobile = freshMobile();
    const first = await ctx.http.post('/api/v1/leads').send(validLead({ mobileNumber: mobile })).expect(201);
    await ctx.db.query(`UPDATE leads SET created_at = now() - interval '8 days' WHERE application_id = $1`, [first.body.applicationId]);
    await ctx.http.post('/api/v1/leads').send(validLead({ mobileNumber: mobile })).expect(201);
  });

  it('a failed (400) request does not burn the 7-day window', async () => {
    const mobile = freshMobile();
    await ctx.http.post('/api/v1/leads').send(validLead({ mobileNumber: mobile, netWeightGrams: 99 })).expect(400);
    await ctx.http.post('/api/v1/leads').send(validLead({ mobileNumber: mobile })).expect(201);
  });
});

describe('GET /leads', () => {
  it('is newest first, always masks the mobile, and never leaks the full number', async () => {
    const mobile = freshMobile();
    const created = await ctx.http.post('/api/v1/leads').send(validLead({ mobileNumber: mobile })).expect(201);
    const res = await ctx.http.get('/api/v1/leads').expect(200);
    expect(res.body.data[0].applicationId).toBe(created.body.applicationId);
    const times = res.body.data.map((l: any) => Date.parse(l.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(JSON.stringify(res.body)).not.toContain(mobile);
    expect(res.body.data[0].mobileNumber).toBe(`${mobile.slice(0, 4)}XXXX${mobile.slice(-2)}`);
  });

  it('filters by plan and paginates', async () => {
    const res = await ctx.http.get('/api/v1/leads?planId=PLAN_BULLET_01&pageSize=1').expect(200);
    expect(res.body.pageSize).toBe(1);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.data.every((l: any) => l.planId === 'PLAN_BULLET_01')).toBe(true);
    await ctx.http.get('/api/v1/leads?pageSize=0').expect(400);
  });
});

describe('error contract', () => {
  it('malformed JSON -> 400 in the standard shape', async () => {
    const res = await ctx.http.post('/api/v1/leads').set('Content-Type', 'application/json').send('{"name": ').expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(res.body.error.fields).toEqual([]);
  });

  it('unknown route -> 404 JSON', async () => {
    const res = await ctx.http.get('/api/v1/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
