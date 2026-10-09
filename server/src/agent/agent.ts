import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { leadInputSchema, zodFields, type LeadInput } from '../domain/schemas.js';
import { formatRupees } from '../domain/money.js';
import { AppError } from '../errors.js';
import { logger, maskMobile } from '../logger.js';
import { createLead, duplicateError, findRecentApplication, type Lead } from '../services/leads.js';
import { calculateQuote } from '../services/quotes.js';
import { getScheme, listSchemes } from '../services/schemes.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { calculateQuoteArgs, coerceNumericFields, TOOL_DEFS } from './tools.js';
import type { ChatMessage, LlmProvider, ToolCall } from './types.js';

export interface PendingSummary {
  token: string;
  summary: {
    name: string;
    mobileNumber: string; // masked
    netWeightGrams: number;
    grossWeightGrams: number;
    karat: number;
    planId: string;
    planName: string;
    pureGoldGrams: string;
    goldValueRupees: string;
    eligibleLoanRupees: number;
    annualInterestRate: number;
    tenureMonths: number;
    monthlyInstalmentRupees?: number;
  };
}

interface Session {
  messages: ChatMessage[];
  pending?: { token: string; payload: LeadInput; view: PendingSummary };
  /** Every tool call made, in order - used by the eval harness to assert behaviour. */
  trace: Array<{ name: string; args: unknown; result: unknown }>;
  touched: number;
}

export interface AgentReply {
  reply: string;
  toolEvents: Array<{ name: string; ok: boolean }>;
  pendingSubmission: PendingSummary | null;
}

const MAX_STEPS = 8;
const MAX_MESSAGES = 120;
const MAX_SESSIONS = 500;

export class AgentService {
  private sessions = new Map<string, Session>();
  constructor(
    private db: Db,
    private provider: LlmProvider,
  ) {}

  get providerName() {
    return this.provider.name;
  }

  session(id: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      if (this.sessions.size >= MAX_SESSIONS) {
        const oldest = [...this.sessions.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
        if (oldest) this.sessions.delete(oldest[0]);
      }
      s = { messages: [{ role: 'system', content: SYSTEM_PROMPT }], trace: [], touched: Date.now() };
      this.sessions.set(id, s);
    }
    s.touched = Date.now();
    return s;
  }

  peek(id: string) {
    return this.sessions.get(id);
  }

  async handleMessage(sessionId: string, userText: string): Promise<AgentReply> {
    const s = this.session(sessionId);
    if (s.messages.length > MAX_MESSAGES) {
      throw new AppError(400, 'SESSION_TOO_LONG', 'This chat has gotten long. Please start a new chat.');
    }
    s.messages.push({ role: 'user', content: userText });
    logger.info(`agent user message: ${userText.slice(0, 200)}`);

    const toolEvents: AgentReply['toolEvents'] = [];
    let reply: string | null = null;

    for (let step = 0; step < MAX_STEPS; step++) {
      const out = await this.provider.chat(s.messages, TOOL_DEFS);
      if (!out.toolCalls.length) {
        reply = out.content?.trim() || null;
        break;
      }
      s.messages.push({ role: 'assistant', content: out.content, tool_calls: out.toolCalls });
      for (const c of out.toolCalls) {
        const result = await this.executeTool(s, c);
        const ok = !(result as any)?.error;
        toolEvents.push({ name: c.name, ok });
        s.messages.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: JSON.stringify(result) });
      }
    }

    reply ??= "Sorry, I got a bit stuck on that. Could you rephrase, or use the form instead?";
    s.messages.push({ role: 'assistant', content: reply });
    return { reply, toolEvents, pendingSubmission: s.pending?.view ?? null };
  }

  /** The ONLY path by which the agent files a lead: an explicit user action, single-use token, same service layer as the form. */
  async confirm(sessionId: string, token: string): Promise<{ lead: Lead; reply: string }> {
    const s = this.sessions.get(sessionId);
    if (!s?.pending || s.pending.token !== token) {
      throw new AppError(409, 'NOTHING_TO_CONFIRM', 'There is no pending application to confirm. It may already have been submitted or cancelled.');
    }
    const { payload, token: t } = s.pending;
    s.pending = undefined; // single use, even if the submit below fails
    try {
      const out = await createLead(this.db, payload, { source: 'AGENT', idempotencyKey: `agent:${t}` });
      const reply = `Your application ${out.lead.applicationId} has been submitted. Preliminary eligible loan: ${formatRupees(out.lead.eligibleLoanRupees)} on ${out.lead.planName}. The lender will review it and contact you; this is not a guarantee of approval.`;
      s.messages.push({ role: 'assistant', content: reply });
      s.trace.push({ name: 'confirm', args: { token: '***' }, result: { applicationId: out.lead.applicationId } });
      return { lead: out.lead, reply };
    } catch (e) {
      if (e instanceof AppError) s.messages.push({ role: 'assistant', content: e.message });
      throw e;
    }
  }

  cancel(sessionId: string): string {
    const s = this.sessions.get(sessionId);
    const reply = 'No problem - I have cancelled that application. Nothing was submitted.';
    if (s) {
      s.pending = undefined;
      s.messages.push({ role: 'assistant', content: reply });
    }
    return reply;
  }

  private async executeTool(s: Session, c: ToolCall): Promise<unknown> {
    const result = await this.runTool(s, c).catch((e) => {
      if (e instanceof AppError) return { error: { code: e.code, message: e.message, fields: e.fields, details: e.details } };
      logger.error(`tool ${c.name} crashed`, e instanceof Error ? e.message : String(e));
      return { error: { code: 'TOOL_FAILED', message: 'The tool failed. Please try again.', fields: [] } };
    });
    logger.info(`agent tool ${c.name} args=${c.arguments.slice(0, 300)} -> ${(result as any)?.error ? 'error' : 'ok'}`);
    let args: unknown = c.arguments;
    try {
      args = JSON.parse(c.arguments);
    } catch {
      /* keep raw */
    }
    s.trace.push({ name: c.name, args, result });
    return result;
  }

  private async runTool(s: Session, c: ToolCall): Promise<unknown> {
    let raw: unknown;
    try {
      raw = c.arguments?.trim() ? JSON.parse(c.arguments) : {};
    } catch {
      return { error: { code: 'INVALID_TOOL_ARGUMENTS', message: 'Tool arguments were not valid JSON. Call the tool again with a valid JSON object.', fields: [] } };
    }
    const args = coerceNumericFields(raw);

    switch (c.name) {
      case 'get_loan_schemes':
        return { data: await listSchemes(this.db) };

      case 'calculate_quote': {
        const p = calculateQuoteArgs.safeParse(args);
        if (!p.success) return validationError(p.error);
        return await calculateQuote(this.db, p.data);
      }

      case 'submit_application': {
        const p = leadInputSchema.safeParse(args);
        if (!p.success) return validationError(p.error);
        const input = p.data;
        const scheme = await getScheme(this.db, input.planId); // throws 404 AppError -> error result
        const dup = await findRecentApplication(this.db, input.mobileNumber);
        if (dup) throw duplicateError(dup);

        // The numbers on the summary card come from the server, never from the model.
        const q = await calculateQuote(this.db, { ...input, planId: scheme.id });
        const plan = q.plans[0];
        const token = randomUUID();
        const view: PendingSummary = {
          token,
          summary: {
            name: input.name,
            mobileNumber: maskMobile(input.mobileNumber),
            netWeightGrams: input.netWeightGrams,
            grossWeightGrams: input.grossWeightGrams,
            karat: input.karat,
            planId: scheme.id,
            planName: scheme.name,
            pureGoldGrams: q.pureGoldGrams,
            goldValueRupees: q.goldValueRupees,
            eligibleLoanRupees: plan.eligibleLoanRupees,
            annualInterestRate: plan.annualInterestRate,
            tenureMonths: plan.tenureMonths,
            ...(plan.monthlyInstalmentRupees !== undefined ? { monthlyInstalmentRupees: plan.monthlyInstalmentRupees } : {}),
          },
        };
        s.pending = { token, payload: input, view }; // replaces any earlier proposal
        return {
          status: 'AWAITING_USER_CONFIRMATION',
          note: 'NOT submitted. The borrower must press Confirm in the app. Do not say it has been submitted.',
          summary: view.summary,
        };
      }

      default:
        return { error: { code: 'UNKNOWN_TOOL', message: `No such tool: ${c.name}`, fields: [] } };
    }
  }
}

function validationError(err: z.ZodError) {
  return { error: { code: 'VALIDATION_ERROR', message: 'Some values are invalid', fields: zodFields(err) } };
}
