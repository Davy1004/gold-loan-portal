import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshMobile, makeApp, validLead } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.db.close();
});

describe('bonus B1: concurrency and idempotency', () => {
  it('case 8: 2 parallel requests, same new mobile -> exactly one 201 and one 409', async () => {
    const body = validLead();
    const [a, b] = await Promise.all([
      ctx.http.post('/api/v1/leads').send(body),
      ctx.http.post('/api/v1/leads').send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const count = await ctx.db.query('SELECT count(*)::int AS c FROM leads WHERE mobile = $1', [body.mobileNumber]);
    expect(count.rows[0].c).toBe(1);
  });

  it('10 parallel requests, same mobile -> still exactly one lead', async () => {
    const body = validLead();
    const res = await Promise.all(Array.from({ length: 10 }, () => ctx.http.post('/api/v1/leads').send(body)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(9);
  });

  it('case 7: same request + same Idempotency-Key replays the original 201 without a second row', async () => {
    const body = validLead();
    const first = await ctx.http.post('/api/v1/leads').set('Idempotency-Key', 'k-1').send(body).expect(201);
    const again = await ctx.http.post('/api/v1/leads').set('Idempotency-Key', 'k-1').send(body).expect(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const count = await ctx.db.query('SELECT count(*)::int AS c FROM leads WHERE mobile = $1', [body.mobileNumber]);
    expect(count.rows[0].c).toBe(1);
  });

  it('same Idempotency-Key with a different body -> 422', async () => {
    await ctx.http.post('/api/v1/leads').set('Idempotency-Key', 'k-2').send(validLead()).expect(201);
    const res = await ctx.http.post('/api/v1/leads').set('Idempotency-Key', 'k-2').send(validLead({ name: 'Other Person' })).expect(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('parallel retries sharing one Idempotency-Key all get the same 201', async () => {
    const body = validLead({ mobileNumber: freshMobile() });
    const res = await Promise.all(
      Array.from({ length: 5 }, () => ctx.http.post('/api/v1/leads').set('Idempotency-Key', 'k-3').send(body)),
    );
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(new Set(res.map((r) => r.body.applicationId)).size).toBe(1);
  });
});
