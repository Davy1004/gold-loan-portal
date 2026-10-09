export type Karat = '18' | '22' | '24';

export interface FormValues {
  name: string;
  mobile: string;
  gross: string;
  net: string;
  karat: Karat | '';
  planId: string;
}

export type FieldKey = keyof FormValues;
export type Errors = Partial<Record<FieldKey, string>>;

export const EMPTY_FORM: FormValues = { name: '', mobile: '', gross: '', net: '', karat: '', planId: '' };

/** The API names fields differently from the form; this maps them back so server errors land inline. */
export const SERVER_FIELD_MAP: Record<string, FieldKey> = {
  name: 'name',
  mobileNumber: 'mobile',
  grossWeightGrams: 'gross',
  netWeightGrams: 'net',
  karat: 'karat',
  planId: 'planId',
};

const WEIGHT_RE = /^\d+(\.\d{1,3})?$/;

function weightError(label: string, raw: string): string | undefined {
  if (raw.trim() === '') return `${label} is required`;
  if (!WEIGHT_RE.test(raw.trim())) return `${label} must be a number with up to 3 decimals`;
  const n = Number(raw);
  if (n <= 0) return `${label} must be greater than 0`;
  if (n > 1000) return `${label} must be at most 1000 g`;
  return undefined;
}

export function validate(v: FormValues): Errors {
  const e: Errors = {};
  const name = v.name.trim();
  if (!name) e.name = 'Name is required';
  else if (name.length < 2) e.name = 'Name must be at least 2 characters';
  else if (name.length > 60) e.name = 'Name must be at most 60 characters';
  else if (!/^\p{L}+(?: \p{L}+)*$/u.test(name)) e.name = 'Use letters and single spaces only';

  if (!v.mobile) e.mobile = 'Mobile number is required';
  else if (!/^[6-9]\d{9}$/.test(v.mobile)) e.mobile = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9';

  const ge = weightError('Gross weight', v.gross);
  if (ge) e.gross = ge;
  const ne = weightError('Net weight', v.net);
  if (ne) e.net = ne;
  if (!ge && !ne && Number(v.net) > Number(v.gross)) e.net = 'Net weight cannot be more than gross weight';

  if (!v.karat) e.karat = 'Choose the karat';
  if (!v.planId) e.planId = 'Choose a plan';
  return e;
}

/** Weights + karat are valid -> numbers ready for /quotes; otherwise null. */
export function parseWeights(v: FormValues): { grossWeightGrams: number; netWeightGrams: number; karat: 18 | 22 | 24 } | null {
  const e = validate(v);
  if (e.gross || e.net || e.karat) return null;
  return { grossWeightGrams: Number(v.gross), netWeightGrams: Number(v.net), karat: Number(v.karat) as 18 | 22 | 24 };
}

export const detailsStepValid = (v: FormValues) => {
  const e = validate(v);
  return !(e.name || e.mobile || e.gross || e.net || e.karat);
};
