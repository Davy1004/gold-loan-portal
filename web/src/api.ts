export interface Scheme {
  id: string;
  name: string;
  description: string;
  repaymentType: 'BULLET' | 'EMI';
  annualInterestRate: number;
  tenureMonths: number;
  maxLtvPercent: number;
}

export interface PlanQuote {
  planId: string;
  planName: string;
  repaymentType: 'BULLET' | 'EMI';
  annualInterestRate: number;
  tenureMonths: number;
  maxLtvPercent: number;
  appliedLtvPercent: number;
  eligibleLoanRupees: number;
  monthlyInstalmentRupees?: number;
  totalInterestRupees: number;
  totalRepayableRupees: number;
}

export interface Quote {
  karat: number;
  netWeightGrams: string;
  pureGoldGrams: string;
  goldValueRupees: string;
  plans: PlanQuote[];
}

export interface Lead {
  applicationId: string;
  name: string;
  mobileNumber: string;
  grossWeightGrams: string;
  netWeightGrams: string;
  karat: number;
  planId: string;
  planName: string;
  pureGoldGrams: string;
  goldValueRupees: string;
  eligibleLoanRupees: number;
  status: string;
  source: 'FORM' | 'AGENT';
  createdAt: string;
}

export interface LeadsPage {
  data: Lead[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PendingSubmission {
  token: string;
  summary: {
    name: string;
    mobileNumber: string;
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

export interface AgentReply {
  reply: string;
  toolEvents: Array<{ name: string; ok: boolean }>;
  pendingSubmission: PendingSubmission | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Array<{ field: string; message: string }> = [],
    public details?: { applicationId?: string; appliedAt?: string },
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong. Please try again.', e?.fields ?? [], e?.details);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown, init?: RequestInit) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), ...init });

export const api = {
  schemes: () => request<{ data: Scheme[] }>('/loan-schemes').then((r) => r.data),
  quote: (body: { netWeightGrams: number; grossWeightGrams: number; karat: number }, signal?: AbortSignal) =>
    post<Quote>('/quotes', body, { signal }),
  createLead: (body: Record<string, unknown>) => post<Lead>('/leads', body),
  leads: (p: { page: number; pageSize: number; planId?: string }) => {
    const q = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) });
    if (p.planId) q.set('planId', p.planId);
    return request<LeadsPage>(`/leads?${q}`);
  },
  agentMessage: (sessionId: string, message: string) => post<AgentReply>('/agent/messages', { sessionId, message }),
  agentConfirm: (sessionId: string, token: string) => post<{ lead: Lead; reply: string }>('/agent/confirm', { sessionId, token }),
  agentCancel: (sessionId: string) => post<{ reply: string }>('/agent/cancel', { sessionId }),
};
