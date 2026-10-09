/**
 * MockLLM: a deterministic, scripted stand-in for a real model so `npm test` and `npm run eval` need no API key.
 *
 * It speaks the same interface as the real providers (messages in -> text or tool calls out) and is built the way a
 * well-behaved model should act: it extracts what the borrower said, asks for what is missing, calls the tools for
 * every number, and only ever *proposes* a submission. It is NOT smart - it exists to exercise the agent's
 * orchestration (tool loop, validation, confirmation gate, duplicate handling, guardrails) reproducibly.
 * The same eval suite can be pointed at a live model with LLM_PROVIDER=gemini.
 */
import { formatRupees } from '../domain/money.js';
import type { ChatMessage, LlmProvider, LlmResult, ToolCall } from './types.js';

interface Slots {
  net?: number;
  gross?: number;
  karat?: number;
  name?: string;
  mobile?: string;
  planId?: string;
}

const NUM = '(\\d+(?:\\.\\d+)?)';
const UNIT = '(?:g|gm|gms|gram|grams)';

const INJECTION =
  /ignore (?:all |the |your )?(?:previous|above|prior|earlier)|system prompt|your instructions|reveal .*(?:prompt|instructions)|without (?:asking|confirm|my confirm)|skip (?:the )?confirm|you are now|developer mode|jailbreak|pretend (?:to be|you)/i;
const ON_TOPIC =
  /gold|loan|jewel|carat|karat|\bgrams?\b|\bgms?\b|apply|application|plan|emi\b|bullet|interest|quote|mobile|phone|\bname\b|confirm|\byes\b|\bno\b|\bok(?:ay)?\b|\bsure\b|\brate|eligible|ornament|chain|bangle|\d/i;
const WANTS_APPLY = /\b(?:yes|yeah|yep|sure|ok(?:ay)?|apply|proceed|go ahead|submit|file it|do it|please do|confirm)\b/i;
const WANTS_PLANS = /(?<!\bemi |\bbullet )\bplans?\b|\bschemes?\b|\brates?\b|\binterest\b|\boptions?\b|\btenure\b/i;

function lastAssistantText(msgs: ChatMessage[], before: number): string {
  for (let i = before - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant' && m.content) return m.content;
  }
  return '';
}

export function extractSlots(msgs: ChatMessage[]): Slots {
  const s: Slots = {};
  msgs.forEach((m, idx) => {
    if (m.role !== 'user') return;
    const t = m.content;
    const prevAsk = lastAssistantText(msgs, idx).toLowerCase();

    const karat = t.match(/(\d{1,2})\s*(?:k|kt|karat|carat|ct)\b/i) ?? t.match(/(?:karat|carat)\s*(?:is|:)?\s*(\d{1,2})\b/i);
    if (karat) s.karat = Number(karat[1]);

    const hasNetWord = /\bnet\b/i.test(t);
    const hasGrossWord = /\bgross\b/i.test(t);
    const kw = (word: string) =>
      t.match(new RegExp(`${NUM}\\s*${UNIT}?\\s*(?:of\\s+)?${word}\\b`, 'i')) ??
      // a number followed by a karat word ("gross of 22 carat") is the karat, not a weight
      t.match(new RegExp(`${word}(?:\\s*weight)?\\s*(?:is|of|:|=)?\\s*${NUM}(?!\\s*(?:k|kt|karat|carat|ct)\\b)`, 'i'));
    const net = kw('net');
    const gross = kw('gross');
    if (net) s.net = Number(net[1]);
    if (gross) s.gross = Number(gross[1]);
    if (!hasNetWord && !hasGrossWord) {
      const bare = t.match(new RegExp(`${NUM}\\s*${UNIT}\\b`, 'i'));
      if (bare) {
        // A bare weight answers whatever the assistant just asked for.
        if (/gross/.test(prevAsk) && !/net weight/.test(prevAsk.split('gross')[0] ?? '')) s.gross = Number(bare[1]);
        else s.net = Number(bare[1]);
      }
    }

    const mob =
      t.match(/mobile[^\d]{0,20}(\d+)/i) ?? t.match(/(?:phone|number)[^\d]{0,15}(\d{5,12})/i) ?? t.match(/\b(\d{10})\b/);
    if (mob) s.mobile = mob[1];

    const nm = t.match(
      /(?:my name is|name is|name:|this is|call me|naam)\s+(\p{L}[\p{L} ]{1,58}?)(?=[,.;!?\n]|\s+and\b|\s+my\b|\s+mobile\b|\s+phone\b|\s+number\b|\s*\d|$)/iu,
    );
    if (nm) s.name = nm[1].trim();

    if (/\bbullet\b/i.test(t)) s.planId = 'PLAN_BULLET_01';
    if (/\bemi\b|monthly/i.test(t)) s.planId = 'PLAN_EMI_01';
  });
  return s;
}

interface Seen {
  call: ToolCall;
  args: any;
  result?: any;
  inThisTurn: boolean;
}

function toolsSeen(msgs: ChatMessage[], name: string, lastUserIdx: number): Seen[] {
  const out: Seen[] = [];
  msgs.forEach((m, i) => {
    if (m.role !== 'assistant' || !m.tool_calls) return;
    for (const c of m.tool_calls) {
      if (c.name !== name) continue;
      let args: any = {};
      try {
        args = JSON.parse(c.arguments);
      } catch {
        /* ignore */
      }
      const res = msgs.find((x) => x.role === 'tool' && x.tool_call_id === c.id) as any;
      let result: any;
      try {
        result = res ? JSON.parse(res.content) : undefined;
      } catch {
        /* ignore */
      }
      out.push({ call: c, args, result, inThisTurn: i > lastUserIdx });
    }
  });
  return out;
}

const call = (msgs: ChatMessage[], name: string, args: unknown): LlmResult => ({
  content: null,
  toolCalls: [{ id: `mock_${msgs.length}_${name}`, name, arguments: JSON.stringify(args) }],
});
const text = (content: string): LlmResult => ({ content, toolCalls: [] });

const errText = (e: any): string => {
  const f: Array<{ message: string }> = e?.fields ?? [];
  return f.length ? f.map((x) => x.message).join('; ') : (e?.message ?? 'something went wrong');
};

function planLine(p: any): string {
  const emi = p.monthlyInstalmentRupees ? ` (about ${formatRupees(p.monthlyInstalmentRupees)}/month)` : '';
  return `- ${p.planName}: up to ${formatRupees(p.eligibleLoanRupees)}${emi}`;
}

export function mockProvider(): LlmProvider {
  return {
    name: 'mock',
    async chat(msgs): Promise<LlmResult> {
      const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
      const userText = (msgs[lastUserIdx] as { content: string }).content;

      if (INJECTION.test(userText)) {
        return text(
          "I can't change how I work or skip any steps, but I'm happy to help with your gold loan. Tell me the net weight, gross weight and karat of your jewellery and I'll get you a quote.",
        );
      }
      if (!ON_TOPIC.test(userText)) {
        return text(
          "I can only help with gold loans, so I can't help with that. If you have gold jewellery, tell me its weight and karat and I'll show you what you could borrow.",
        );
      }

      const slots = extractSlots(msgs);
      const parts: string[] = [];

      // 1. Plans: only ever described from get_loan_schemes
      const schemesCalls = toolsSeen(msgs, 'get_loan_schemes', lastUserIdx);
      const schemes = schemesCalls.find((s) => s.result)?.result?.data as any[] | undefined;
      const askedPlans = WANTS_PLANS.test(userText);
      if (askedPlans && !schemesCalls.some((s) => s.inThisTurn)) return call(msgs, 'get_loan_schemes', {});
      if (askedPlans && schemes && schemesCalls.some((s) => s.inThisTurn)) {
        parts.push(
          'Here are our plans:\n' +
            schemes
              .map((s) => `- ${s.name}: ${s.annualInterestRate}% p.a., ${s.tenureMonths} months, up to ${s.maxLtvPercent}% of gold value`)
              .join('\n'),
        );
      }

      // 2. Quote
      const haveWeights = slots.net !== undefined && slots.gross !== undefined && slots.karat !== undefined;
      if (!haveWeights) {
        const missing: string[] = [];
        if (slots.net === undefined) missing.push('the net weight of your gold in grams');
        if (slots.gross === undefined) missing.push('the gross weight in grams');
        if (slots.karat === undefined) missing.push('the karat (18, 22 or 24)');
        parts.push(`To get your quote, could you tell me ${missing.join(' and ')}?`);
        return text(parts.join('\n\n'));
      }

      const quoteArgs = { netWeightGrams: slots.net, grossWeightGrams: slots.gross, karat: slots.karat };
      const quotes = toolsSeen(msgs, 'calculate_quote', lastUserIdx);
      const sameQuote = quotes
        .filter((q) => q.args.netWeightGrams === quoteArgs.netWeightGrams && q.args.grossWeightGrams === quoteArgs.grossWeightGrams && q.args.karat === quoteArgs.karat)
        .at(-1);
      if (!sameQuote) return call(msgs, 'calculate_quote', quoteArgs);

      if (sameQuote.result?.error) {
        parts.push(`I couldn't calculate that: ${errText(sameQuote.result.error)}. Could you check the weights and karat and tell me the correct values?`);
        return text(parts.join('\n\n'));
      }
      const quote = sameQuote.result;
      if (sameQuote.inThisTurn) {
        parts.push(
          `For ${quote.netWeightGrams} g of ${quote.karat}K gold (pure gold ${quote.pureGoldGrams} g, value ${formatRupees(Math.floor(Number(quote.goldValueRupees)))}), this is the most you could borrow (preliminary estimate, subject to the lender's approval):\n` +
            quote.plans.map(planLine).join('\n'),
        );
      }

      // 3. Remaining details
      const planOk = slots.planId && quote.plans.some((p: any) => p.planId === slots.planId);
      const missing: string[] = [];
      if (!planOk) missing.push(`which plan you'd like (${quote.plans.map((p: any) => p.planName).join(' or ')})`);
      if (!slots.name) missing.push('your full name');
      if (!slots.mobile) missing.push('your 10-digit mobile number');

      const submits = toolsSeen(msgs, 'submit_application', lastUserIdx);
      const payload = {
        name: slots.name,
        mobileNumber: slots.mobile,
        grossWeightGrams: slots.gross,
        netWeightGrams: slots.net,
        karat: slots.karat,
        planId: slots.planId,
      };
      const lastSubmit = submits.at(-1);
      const samePayload = lastSubmit && JSON.stringify(lastSubmit.args) === JSON.stringify(payload);

      if (lastSubmit?.inThisTurn && lastSubmit.result) {
        const r = lastSubmit.result;
        if (r.error) {
          parts.push(
            r.error.code === 'DUPLICATE_APPLICATION'
              ? `${r.error.message} I can't file another one for this number right now.`
              : `I couldn't prepare the application: ${errText(r.error)}. Could you give me the corrected details?`,
          );
        } else {
          parts.push('Your application summary is ready. Please review it below and press Confirm to submit - nothing is filed until you do.');
        }
        return text(parts.join('\n\n'));
      }

      if (missing.length) {
        parts.push(`To go ahead with an application, I also need ${missing.join(', ')}.`);
        return text(parts.join('\n\n'));
      }

      const wantsApply = WANTS_APPLY.test(userText);
      if (wantsApply && !samePayload) return call(msgs, 'submit_application', payload);
      if (samePayload && lastSubmit?.result && !lastSubmit.result.error) {
        parts.push('Your application summary is still waiting for you - press Confirm below to submit it.');
      } else {
        parts.push('Would you like me to prepare your application for review? (yes/no)');
      }
      return text(parts.join('\n\n'));
    },
  };
}
