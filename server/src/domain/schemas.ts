import { z } from 'zod';
import type { FieldError } from '../errors.js';

const num = (label: string) =>
  z.number({
    error: (iss) => (iss.input === undefined ? `${label} is required` : `${label} must be a number`),
  });

const weight = (label: string) =>
  num(label)
    .gt(0, `${label} must be greater than 0`)
    .max(1000, `${label} must be at most 1000 g`)
    .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, `${label} can have at most 3 decimal places`);

export const nameSchema = z
  .string({ error: (i) => (i.input === undefined ? 'Name is required' : 'Name must be text') })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(60, 'Name must be at most 60 characters')
  .regex(/^\p{L}+(?: \p{L}+)*$/u, 'Name can contain only letters and single spaces');

export const mobileSchema = z
  .string({ error: (i) => (i.input === undefined ? 'Mobile number is required' : 'Mobile number must be text') })
  .regex(/^[6-9]\d{9}$/, 'Mobile must be a 10-digit Indian number starting with 6-9');

export const karatSchema = z.literal([18, 22, 24], {
  error: (i) => (i.input === undefined ? 'Karat is required' : 'Karat must be 18, 22 or 24'),
});

const weightFields = {
  grossWeightGrams: weight('Gross weight'),
  netWeightGrams: weight('Net weight'),
  karat: karatSchema,
};

const netNotAboveGross = (v: { netWeightGrams: number; grossWeightGrams: number }) =>
  v.netWeightGrams <= v.grossWeightGrams;
const netNotAboveGrossMsg = { path: ['netWeightGrams'], message: 'Net weight cannot be more than gross weight' };

/** POST /quotes body, and the agent's calculate_quote arguments. */
export const quoteInputSchema = z
  .object({ ...weightFields, planId: z.string().min(1).optional() })
  .refine(netNotAboveGross, netNotAboveGrossMsg);

/** POST /leads body, and the agent's submit_application payload. */
export const leadInputSchema = z
  .object({
    name: nameSchema,
    mobileNumber: mobileSchema,
    ...weightFields,
    planId: z.string({ error: 'Plan is required' }).min(1, 'Plan is required'),
  })
  .refine(netNotAboveGross, netNotAboveGrossMsg);

export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type LeadInput = z.infer<typeof leadInputSchema>;

export const emptyObject = z.object({});

export function zodFields(err: z.ZodError): FieldError[] {
  return err.issues.map((i) => ({ field: i.path.map(String).join('.') || '_', message: i.message }));
}
