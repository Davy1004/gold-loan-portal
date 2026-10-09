import { z } from 'zod';
import type { ToolDef } from './types.js';
import { emptyObject, leadInputSchema, quoteInputSchema } from '../domain/schemas.js';

// The agent's tool arguments are validated by the SAME Zod schemas as the REST API,
// and the JSON Schema shown to the model is generated from them (one source of truth).
const toJson = (s: z.ZodType) => {
  const j = z.toJSONSchema(s, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

// The agent never picks a plan when quoting: the server returns every plan.
export const calculateQuoteArgs = z
  .object({
    netWeightGrams: quoteInputSchema.shape.netWeightGrams,
    grossWeightGrams: quoteInputSchema.shape.grossWeightGrams,
    karat: quoteInputSchema.shape.karat,
  })
  .refine((v) => v.netWeightGrams <= v.grossWeightGrams, {
    path: ['netWeightGrams'],
    message: 'Net weight cannot be more than gross weight',
  });

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'get_loan_schemes',
    description: 'List the active gold-loan plans (id, name, interest rate, tenure, max LTV). The only source for plan details.',
    parameters: toJson(emptyObject),
  },
  {
    name: 'calculate_quote',
    description:
      'Calculate pure gold, gold value and the eligible loan for every plan. Never do this arithmetic yourself - always call this tool.',
    parameters: toJson(calculateQuoteArgs),
  },
  {
    name: 'submit_application',
    description:
      'Prepare a loan application for the borrower to review. It is NOT filed until the borrower presses Confirm in the app.',
    parameters: toJson(leadInputSchema),
  },
];

/** LLMs often send numbers as strings ("45"). Coerce only numeric-looking strings for numeric fields. */
export function coerceNumericFields(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const k of ['netWeightGrams', 'grossWeightGrams', 'karat']) {
    const v = out[k];
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  if (typeof out.mobileNumber === 'number') out.mobileNumber = String(out.mobileNumber);
  return out;
}
