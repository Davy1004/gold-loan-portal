import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentService } from '../src/agent/agent.js';
import { extractSlots, mockProvider } from '../src/agent/mock.js';
import { agentRouter } from '../src/agent/router.js';
import { TOOL_DEFS } from '../src/agent/tools.js';
import type { ChatMessage, LlmProvider, LlmResult } from '../src/agent/types.js';
import { bootDb } from '../src/db/boot.js';
import type { Db } from '../src/db/index.js';
import { createApp } from '../src/http/app.js';
import { Harness, newMobile, scenarios } from '../eval/scenarios.js';
import { createLead } from '../src/services/leads.js';

let db: Db;
beforeAll(async () => {
  db = await bootDb({ inMemory: true, databaseUrl: process.env.TEST_DATABASE_URL });
});
afterAll(async () => {
  await db.close();
});

/** Scripted provider for adversarial / malformed model behaviour. */
const scripted = (steps: Array<(m: ChatMessage[]) => LlmResult>): LlmProvider => {
  let i = 0;
  return { name: 'scripted', chat: async (m) => steps[Math.min(i++, steps.length - 1)](m) };
};
const toolCall = (name: string, args: unknown, raw?: string): LlmResult => ({
  content: null,
  toolCalls: [{ id: `c${Math.random().toString(36).slice(2)}`, name, arguments: raw ?? JSON.stringify(args) }],
});
const say = (content: string): LlmResult => ({ content, toolCalls: [] });
const leadCount = async (mobile: string) =>
  (await db.query('SELECT count(*)::int AS c FROM leads WHERE mobile = $1', [mobile])).rows[0].c as number;

describe('the 5 required test conversations + bonuses (same scenarios as `npm run eval`)', () => {
  for (const sc of scenarios) {
    it(`#${sc.id} ${sc.title}`, async () => {
      // Fresh in-memory database per conversation, exactly like `npm run eval`.
      const sdb = await bootDb({ inMemory: true });
      const h = new Harness(new AgentService(sdb, mockProvider()), sdb);
      const checks = await sc.run(h);
      await sdb.close();
      const failed = checks.filter((c) => !c.pass);
      expect(failed, JSON.stringify(failed, null, 1)).toEqual([]);
    });
  }
});

describe('confirmation is enforced by the server, not just the prompt', () => {
  const full = (mobile: string) => ({
    name: 'Ravi Kumar',
    mobileNumber: mobile,
    grossWeightGrams: 50,
    netWeightGrams: 45,
    karat: 22 as const,
    planId: 'PLAN_EMI_01',
  });

  it('an over-eager model that calls submit_application every turn can never file a lead by itself', async () => {
    const mobile = newMobile();
    const agent = new AgentService(db, scripted([() => toolCall('submit_application', full(mobile)), () => say('Done! I have submitted it.')]));
    const r = await agent.handleMessage('sess-eager-1', 'apply for me');
    expect(r.pendingSubmission).not.toBeNull();
    expect(await leadCount(mobile)).toBe(0);
  });

  it('confirm files the lead once; the token is single-use', async () => {
    const mobile = newMobile();
    const agent = new AgentService(db, scripted([() => toolCall('submit_application', full(mobile)), () => say('Please confirm.')]));
    const r = await agent.handleMessage('sess-token-1', 'apply');
    const { lead } = await agent.confirm('sess-token-1', r.pendingSubmission!.token);
    expect(lead.eligibleLoanRupees).toBe(216562);
    expect(await leadCount(mobile)).toBe(1);
    await expect(agent.confirm('sess-token-1', r.pendingSubmission!.token)).rejects.toMatchObject({ status: 409, code: 'NOTHING_TO_CONFIRM' });
    expect(await leadCount(mobile)).toBe(1);
  });

  it('a wrong token, or another session\'s token, cannot confirm', async () => {
    const mobile = newMobile();
    const agent = new AgentService(db, scripted([() => toolCall('submit_application', full(mobile)), () => say('Please confirm.')]));
    const r = await agent.handleMessage('sess-owner-1', 'apply');
    await expect(agent.confirm('sess-owner-1', 'not-the-token')).rejects.toMatchObject({ code: 'NOTHING_TO_CONFIRM' });
    await expect(agent.confirm('sess-other-1', r.pendingSubmission!.token)).rejects.toMatchObject({ code: 'NOTHING_TO_CONFIRM' });
    expect(await leadCount(mobile)).toBe(0);
  });

  it('cancel discards the pending application', async () => {
    const mobile = newMobile();
    const agent = new AgentService(db, scripted([() => toolCall('submit_application', full(mobile)), () => say('ok')]));
    const r = await agent.handleMessage('sess-cancel-1', 'apply');
    agent.cancel('sess-cancel-1');
    await expect(agent.confirm('sess-cancel-1', r.pendingSubmission!.token)).rejects.toMatchObject({ code: 'NOTHING_TO_CONFIRM' });
    expect(await leadCount(mobile)).toBe(0);
  });

  it('if the same mobile applies elsewhere before Confirm, Confirm returns 409 and files nothing extra', async () => {
    const mobile = newMobile();
    const agent = new AgentService(db, scripted([() => toolCall('submit_application', full(mobile)), () => say('Please confirm.')]));
    const r = await agent.handleMessage('sess-race-1', 'apply');
    await createLead(db, full(mobile), { source: 'FORM' });
    await expect(agent.confirm('sess-race-1', r.pendingSubmission!.token)).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_APPLICATION' });
    expect(await leadCount(mobile)).toBe(1);
  });

  it('the summary card numbers come from the server even if the model sends its own amounts', async () => {
    const mobile = newMobile();
    const agent = new AgentService(
      db,
      scripted([() => toolCall('submit_application', { ...full(mobile), eligibleLoanRupees: 9999999 }), () => say('Please confirm.')]),
    );
    const r = await agent.handleMessage('sess-lies-1', 'apply');
    expect(r.pendingSubmission!.summary.eligibleLoanRupees).toBe(216562);
  });
});

describe('tool-call robustness', () => {
  it('malformed JSON arguments are returned to the model as an error, and the loop recovers', async () => {
    const agent = new AgentService(
      db,
      scripted([
        () => toolCall('calculate_quote', null, '{"netWeightGrams": 45, "grossWe'),
        (m) => {
          const last = m[m.length - 1] as any;
          expect(last.role).toBe('tool');
          expect(JSON.parse(last.content).error.code).toBe('INVALID_TOOL_ARGUMENTS');
          return say('Sorry, could you repeat the weights?');
        },
      ]),
    );
    const r = await agent.handleMessage('sess-bad-json', 'quote me');
    expect(r.reply).toContain('repeat');
    expect(r.toolEvents).toEqual([{ name: 'calculate_quote', ok: false }]);
  });

  it('numbers sent as strings by the model are coerced; invalid ones come back as field errors', async () => {
    const agent = new AgentService(
      db,
      scripted([
        () => toolCall('calculate_quote', { netWeightGrams: '45', grossWeightGrams: '50', karat: '22' }),
        () => toolCall('calculate_quote', { netWeightGrams: 'lots', grossWeightGrams: 50, karat: 22 }),
        () => say('ok'),
      ]),
    );
    await agent.handleMessage('sess-coerce', 'quote');
    const trace = agent.peek('sess-coerce')!.trace;
    expect((trace[0].result as any).plans[0].eligibleLoanRupees).toBeGreaterThan(0);
    expect((trace[1].result as any).error.fields[0].field).toBe('netWeightGrams');
  });

  it('an unknown tool is an error result, not a crash', async () => {
    const agent = new AgentService(db, scripted([() => toolCall('delete_everything', {}), () => say('sorry')]));
    const r = await agent.handleMessage('sess-unknown-tool', 'hi gold loan');
    expect(r.reply).toBe('sorry');
    expect((agent.peek('sess-unknown-tool')!.trace[0].result as any).error.code).toBe('UNKNOWN_TOOL');
  });

  it('a model stuck in a tool loop is stopped with a friendly message', async () => {
    const agent = new AgentService(db, scripted([() => toolCall('get_loan_schemes', {})]));
    const r = await agent.handleMessage('sess-loop', 'plans?');
    expect(r.reply).toMatch(/stuck/i);
  });

  it('tool JSON schemas are generated from the same Zod schemas as the API', () => {
    const submit = TOOL_DEFS.find((t) => t.name === 'submit_application')!.parameters as any;
    expect(Object.keys(submit.properties).sort()).toEqual(
      ['grossWeightGrams', 'karat', 'mobileNumber', 'name', 'netWeightGrams', 'planId'].sort(),
    );
    expect(submit.properties.karat.enum).toEqual([18, 22, 24]);
    expect(submit.properties.mobileNumber.pattern).toBe('^[6-9]\\d{9}$');
    expect(TOOL_DEFS.map((t) => t.name)).toEqual(['get_loan_schemes', 'calculate_quote', 'submit_application']);
  });
});

describe('same truth, two paths', () => {
  it('a lead filed via the agent is identical to one filed via the form (apart from id, mobile and source)', async () => {
    const body = { name: 'Priya Singh', grossWeightGrams: 30.5, netWeightGrams: 28.25, karat: 18, planId: 'PLAN_BULLET_01' };
    const m1 = newMobile();
    const m2 = newMobile();
    const form = await createLead(db, { ...body, mobileNumber: m1 } as any, { source: 'FORM' });
    const agent = new AgentService(db, scripted([() => toolCall('submit_application', { ...body, mobileNumber: m2 }), () => say('confirm')]));
    const r = await agent.handleMessage('sess-same-truth', 'apply');
    const viaAgent = await agent.confirm('sess-same-truth', r.pendingSubmission!.token);
    const strip = ({ applicationId, mobileNumber, source, createdAt, ...rest }: any) => rest;
    expect(strip(viaAgent.lead)).toEqual(strip(form.lead));
    expect(viaAgent.lead.source).toBe('AGENT');
  });
});

describe('agent HTTP endpoints', () => {
  it('messages -> confirm -> visible (masked) in GET /leads; errors use the standard shape', async () => {
    const agent = new AgentService(db, mockProvider());
    const app = createApp({ db, extraRouters: [agentRouter(agent)] });
    const http = request(app);
    const mobile = newMobile();
    const sessionId = 'http-session-0001';

    const m = await http
      .post('/api/v1/agent/messages')
      .send({ sessionId, message: `45g net, 50g gross, 22 carat, EMI plan, my name is Ravi Kumar, mobile ${mobile}, yes apply` })
      .expect(200);
    expect(m.body.pendingSubmission.summary.mobileNumber).toBe(`${mobile.slice(0, 4)}XXXX${mobile.slice(-2)}`);
    expect(JSON.stringify(m.body)).not.toContain(mobile);
    expect(m.body.toolEvents.map((e: any) => e.name)).toContain('calculate_quote');

    const c = await http.post('/api/v1/agent/confirm').send({ sessionId, token: m.body.pendingSubmission.token }).expect(201);
    expect(c.body.lead.applicationId).toMatch(/^GL-\d+$/);
    const list = await http.get('/api/v1/leads').expect(200);
    expect(list.body.data[0].applicationId).toBe(c.body.lead.applicationId);
    expect(JSON.stringify(list.body)).not.toContain(mobile);

    const bad = await http.post('/api/v1/agent/messages').send({ sessionId: 'x', message: '' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    await http.post('/api/v1/agent/confirm').send({ sessionId, token: m.body.pendingSubmission.token }).expect(409);
  });

  it('LLM outage surfaces as a friendly 503 in the standard shape', async () => {
    const { AppError } = await import('../src/errors.js');
    const broken: LlmProvider = {
      name: 'broken',
      chat: async () => {
        throw new AppError(503, 'LLM_BUSY', 'The assistant is busy right now. Please try again in a few seconds.');
      },
    };
    const app = createApp({ db, extraRouters: [agentRouter(new AgentService(db, broken))] });
    const res = await request(app).post('/api/v1/agent/messages').send({ sessionId: 'http-session-0002', message: 'hello gold' }).expect(503);
    expect(res.body.error.code).toBe('LLM_BUSY');
  });
});

describe('mock slot extraction (regression: phrasing found by the manual smoke test)', () => {
  const slots = (t: string) => extractSlots([{ role: 'user', content: t }]);
  it('"45 grams net, 50 grams gross of 22 carat" is net 45 / gross 50 / karat 22 (not gross 22)', () => {
    expect(slots('I have 45 grams net, 50 grams gross of 22 carat gold, how much can I get?')).toMatchObject({ net: 45, gross: 50, karat: 22 });
  });
  it('keyword-first phrasing still works', () => {
    expect(slots('net weight 52g and gross weight 50g, 22 carat')).toMatchObject({ net: 52, gross: 50, karat: 22 });
    expect(slots('gross is 50 and net is 45 in 18k')).toMatchObject({ net: 45, gross: 50, karat: 18 });
  });
});
