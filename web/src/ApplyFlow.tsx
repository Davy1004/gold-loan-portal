import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Lead, type Scheme } from './api';
import { Field } from './Field';
import { formatDay, formatRupees } from './format';
import { useQuote } from './useQuote';
import {
  detailsStepValid,
  EMPTY_FORM,
  SERVER_FIELD_MAP,
  validate,
  type Errors,
  type FieldKey,
  type FormValues,
} from './validation';

type Step = 1 | 2 | 3 | 'done';

const STEPS = ['Details', 'Live quote', 'Confirm'] as const;

function Stepper({ step }: { step: Step }) {
  const current = step === 'done' ? 4 : step;
  return (
    <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                state === 'todo' ? 'bg-stone-200 text-stone-600' : state === 'current' ? 'bg-gold-600 text-white' : 'bg-forest-800 text-white'
              }`}
            >
              {state === 'done' ? '✓' : n}
            </span>
            <span className={`truncate ${state === 'current' ? 'font-semibold' : 'text-stone-600'}`}>{label}</span>
            {n < 3 && <span className="h-px flex-1 bg-stone-300" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function ApplyFlow() {
  const [step, setStep] = useState<Step>(1);
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'duplicate' | 'error'; text: string } | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);

  const { quote, loading, error: quoteError } = useQuote(values);
  const errors = useMemo(() => validate(values), [values]);

  useEffect(() => {
    api.schemes().then(setSchemes).catch(() => undefined);
  }, []);

  const set = (k: FieldKey, v: string) => {
    setValues((p) => ({ ...p, [k]: v }));
    setTouched((p) => ({ ...p, [k]: true }));
    setServerErrors((p) => ({ ...p, [k]: undefined }));
    setBanner(null);
  };
  const shown = (k: FieldKey) => (touched[k] ? (errors[k] ?? serverErrors[k]) : serverErrors[k]);

  const next = () => {
    if (!detailsStepValid(values)) {
      setTouched({ name: true, mobile: true, gross: true, net: true, karat: true });
      return;
    }
    setStep(2);
  };

  const submit = async () => {
    setSubmitting(true);
    setBanner(null);
    try {
      const created = await api.createLead({
        name: values.name.trim(),
        mobileNumber: values.mobile,
        grossWeightGrams: Number(values.gross),
        netWeightGrams: Number(values.net),
        karat: Number(values.karat),
        planId: values.planId,
      });
      setLead(created);
      setStep('done');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const d = e.details;
        setBanner({
          kind: 'duplicate',
          text: d?.applicationId && d.appliedAt ? `You already applied on ${formatDay(d.appliedAt)}, application ${d.applicationId}.` : e.message,
        });
      } else if (e instanceof ApiError && e.status === 400 && e.fields.length) {
        const mapped: Errors = {};
        for (const f of e.fields) {
          const k = SERVER_FIELD_MAP[f.field];
          if (k && !mapped[k]) mapped[k] = f.message;
        }
        setServerErrors(mapped);
        setTouched({ name: true, mobile: true, gross: true, net: true, karat: true, planId: true });
        setStep(mapped.planId && Object.keys(mapped).length === 1 ? 2 : 1);
        setBanner({ kind: 'error', text: 'Please fix the highlighted fields.' });
      } else if (e instanceof ApiError && e.status === 404) {
        setServerErrors({ planId: e.message });
        setStep(2);
      } else {
        setBanner({ kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setValues(EMPTY_FORM);
    setTouched({});
    setServerErrors({});
    setBanner(null);
    setLead(null);
    setStep(1);
  };

  const chosen = quote?.plans.find((p) => p.planId === values.planId);

  if (step === 'done' && lead) {
    return (
      <section className="rounded-2xl border border-forest-600/30 bg-white p-6 shadow-sm" aria-live="polite">
        <div className="mb-3 grid size-12 place-items-center rounded-full bg-forest-50 text-2xl text-forest-600" aria-hidden>
          ✓
        </div>
        <h2 className="text-2xl font-bold">Application submitted</h2>
        <p className="mt-1 text-stone-600">Keep this Application ID. The lender will review it and contact you. This is a preliminary estimate, not a guarantee of approval.</p>
        <p className="mt-4 rounded-xl bg-gold-50 px-4 py-3 text-center text-3xl font-extrabold tracking-wide text-gold-700" data-testid="application-id">
          {lead.applicationId}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Item k="Name" v={lead.name} />
          <Item k="Mobile" v={lead.mobileNumber} />
          <Item k="Plan" v={lead.planName} />
          <Item k="Eligible loan" v={formatRupees(lead.eligibleLoanRupees)} strong />
        </dl>
        <button className="btn btn-primary mt-6 w-full sm:w-auto" onClick={reset}>
          Start another application
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
      <Stepper step={step} />

      {banner && (
        <div
          role="alert"
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            banner.kind === 'duplicate' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          <strong className="block">{banner.kind === 'duplicate' ? 'This number has already applied' : 'Could not submit'}</strong>
          {banner.text}
          {banner.kind === 'duplicate' && <span className="block">You can apply again 7 days after your earlier application.</span>}
        </div>
      )}

      {step === 1 && (
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <h2 className="text-xl font-bold">Borrower and gold details</h2>
          <Field id="name" label="Full name" error={shown('name')}>
            {(a) => (
              <input {...a} className="field-input" autoComplete="name" value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Ravi Kumar" />
            )}
          </Field>
          <Field id="mobile" label="Mobile number" error={shown('mobile')} hint="10 digits, no +91">
            {(a) => (
              <input
                {...a}
                className="field-input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                value={values.mobile}
                onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))}
                placeholder="98765 43210"
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="gross" label="Gross weight (g)" error={shown('gross')}>
              {(a) => (
                <input {...a} className="field-input" inputMode="decimal" value={values.gross} onChange={(e) => set('gross', e.target.value)} placeholder="50" />
              )}
            </Field>
            <Field id="net" label="Net weight (g)" error={shown('net')}>
              {(a) => <input {...a} className="field-input" inputMode="decimal" value={values.net} onChange={(e) => set('net', e.target.value)} placeholder="45" />}
            </Field>
          </div>
          <Field id="karat" label="Karat" error={shown('karat')}>
            {(a) => (
              <select {...a} className="field-input" value={values.karat} onChange={(e) => set('karat', e.target.value)}>
                <option value="">Select karat</option>
                <option value="18">18K</option>
                <option value="22">22K</option>
                <option value="24">24K</option>
              </select>
            )}
          </Field>

          <EstimateStrip quote={quote} loading={loading} error={quoteError} />

          <button type="submit" className="btn btn-primary w-full sm:w-auto sm:justify-self-end">
            See my quote
          </button>
        </form>
      )}

      {step === 2 && (
        <div className="grid gap-4">
          <h2 className="text-xl font-bold">Choose your plan</h2>

          <fieldset className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Adjust to re-quote</legend>
            <div className="grid grid-cols-3 gap-2">
              <Field id="q-net" label="Net (g)" error={shown('net')}>
                {(a) => <input {...a} className="field-input" inputMode="decimal" value={values.net} onChange={(e) => set('net', e.target.value)} />}
              </Field>
              <Field id="q-gross" label="Gross (g)" error={shown('gross')}>
                {(a) => <input {...a} className="field-input" inputMode="decimal" value={values.gross} onChange={(e) => set('gross', e.target.value)} />}
              </Field>
              <Field id="q-karat" label="Karat">
                {(a) => (
                  <select {...a} className="field-input" value={values.karat} onChange={(e) => set('karat', e.target.value)}>
                    <option value="18">18K</option>
                    <option value="22">22K</option>
                    <option value="24">24K</option>
                  </select>
                )}
              </Field>
            </div>
          </fieldset>

          <div aria-live="polite" className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {quoteError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{quoteError}</p>}
            {quote && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Pure gold" value={`${quote.pureGoldGrams} g`} />
                  <Stat label="Gold value" value={formatRupees(quote.goldValueRupees)} />
                </div>
                <div role="radiogroup" aria-label="Loan plans" className="mt-3 grid gap-3 sm:grid-cols-2">
                  {quote.plans.map((p) => {
                    const selected = values.planId === p.planId;
                    return (
                      <button
                        key={p.planId}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => set('planId', p.planId)}
                        className={`rounded-xl border-2 p-4 text-left transition-colors ${
                          selected ? 'border-gold-600 bg-gold-50 shadow-sm' : 'border-stone-200 bg-white hover:border-stone-400'
                        }`}
                      >
                        <span className="flex items-center justify-between">
                          <span className="font-bold">{p.planName}</span>
                          <span
                            className={`grid size-5 place-items-center rounded-full border-2 text-[10px] ${selected ? 'border-gold-600 bg-gold-600 text-white' : 'border-stone-300'}`}
                            aria-hidden
                          >
                            {selected ? '✓' : ''}
                          </span>
                        </span>
                        <span className="mt-2 block text-3xl font-extrabold text-forest-800">{formatRupees(p.eligibleLoanRupees)}</span>
                        <span className="block text-xs text-stone-500">eligible loan ({p.appliedLtvPercent}% of value)</span>
                        <span className="mt-2 block text-sm text-stone-700">
                          {p.annualInterestRate}% p.a. · {p.tenureMonths} months
                        </span>
                        <span className="block text-sm text-stone-700">
                          {p.monthlyInstalmentRupees
                            ? `About ${formatRupees(p.monthlyInstalmentRupees)} / month`
                            : `Pay ${formatRupees(p.totalRepayableRupees)} at maturity`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {!quote && !quoteError && <p className="text-stone-500">{loading ? 'Calculating…' : 'Enter valid weights and karat to see plans.'}</p>}
            {shown('planId') && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {shown('planId')}
              </p>
            )}
          </div>

          <p className="text-xs text-stone-500">Preliminary estimate at today's gold rate. Final approval is by the lender.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button className="btn btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              className="btn btn-primary"
              disabled={!values.planId || !chosen}
              onClick={() => {
                setTouched((p) => ({ ...p, planId: true }));
                if (chosen) setStep(3);
              }}
            >
              Review application
            </button>
          </div>
        </div>
      )}

      {step === 3 && chosen && quote && (
        <div className="grid gap-4">
          <h2 className="text-xl font-bold">Review and confirm</h2>
          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-stone-50 p-4 text-sm">
            <Item k="Name" v={values.name.trim()} />
            <Item k="Mobile" v={`${values.mobile.slice(0, 4)}XXXX${values.mobile.slice(-2)}`} />
            <Item k="Gross / net" v={`${values.gross} g / ${values.net} g`} />
            <Item k="Karat" v={`${values.karat}K`} />
            <Item k="Pure gold" v={`${quote.pureGoldGrams} g`} />
            <Item k="Gold value" v={formatRupees(quote.goldValueRupees)} />
            <Item k="Plan" v={chosen.planName} />
            <Item k="Rate / tenure" v={`${chosen.annualInterestRate}% · ${chosen.tenureMonths} mo`} />
          </dl>
          <p className="rounded-xl bg-gold-50 p-4 text-center">
            <span className="block text-sm text-stone-600">Eligible loan</span>
            <span className="text-4xl font-extrabold text-forest-800">{formatRupees(chosen.eligibleLoanRupees)}</span>
          </p>
          <p className="text-xs text-stone-500">The lender re-verifies every figure on submission. This is not a guarantee of approval.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button className="btn btn-secondary" onClick={() => setStep(2)} disabled={submitting}>
              Back
            </button>
            <button className="btn btn-gold" onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit application'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function EstimateStrip({ quote, loading, error }: { quote: ReturnType<typeof useQuote>['quote']; loading: boolean; error: string | null }) {
  const best = quote ? Math.max(...quote.plans.map((p) => p.eligibleLoanRupees)) : null;
  return (
    <div aria-live="polite" className="rounded-xl border border-dashed border-gold-500/60 bg-gold-50 px-4 py-3 text-sm">
      {error ? (
        <span className="text-red-700">{error}</span>
      ) : loading ? (
        <span className="text-stone-600">Calculating…</span>
      ) : best !== null && quote ? (
        <span>
          Pure gold <strong>{quote.pureGoldGrams} g</strong> · worth <strong>{formatRupees(quote.goldValueRupees)}</strong> · loan up to{' '}
          <strong className="text-forest-800">{formatRupees(best)}</strong>
        </span>
      ) : (
        <span className="text-stone-600">Enter weights and karat for an instant estimate.</span>
      )}
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-stone-50 p-3">
    <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
    <div className="text-xl font-bold">{value}</div>
  </div>
);

const Item = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-stone-500">{k}</dt>
    <dd className={strong ? 'font-bold text-forest-800' : 'font-medium'}>{v}</dd>
  </div>
);
