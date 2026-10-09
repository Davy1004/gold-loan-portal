import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type PendingSubmission } from './api';
import { formatRupees } from './format';

interface Msg {
  role: 'user' | 'assistant' | 'error';
  text: string;
  chips?: string[];
}

const CHIP_LABEL: Record<string, string> = {
  get_loan_schemes: 'Looked up loan plans',
  calculate_quote: 'Calculated quote',
  submit_application: 'Prepared application',
};

const WORKING_LABEL: Record<string, string> = {
  get_loan_schemes: 'Looking up plans…',
  calculate_quote: 'Calculating quote…',
};

const WELCOME: Msg = {
  role: 'assistant',
  text: 'Hi, I\'m Loan Assist. Tell me about your gold, for example "I have 45 grams of 22 carat jewellery, how much can I get?" and I\'ll get you a quote.',
};

const newSession = () => (globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function ChatPanel({ onFiled }: { onFiled: () => void }) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(newSession);
  const [msgs, setMsgs] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState('Thinking…');
  const [pending, setPending] = useState<PendingSubmission | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, pending, busy]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const push = (m: Msg) => setMsgs((p) => [...p, m]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput('');
    push({ role: 'user', text: t });
    setBusy(true);
    setWorking('Thinking…');
    // The reply is not streamed, so show a plausible status chip while we wait.
    const hint = /plan|rate|interest|scheme/i.test(t) ? WORKING_LABEL.get_loan_schemes : /\d/.test(t) ? WORKING_LABEL.calculate_quote : 'Thinking…';
    setWorking(hint);
    try {
      const r = await api.agentMessage(sessionId, t);
      push({ role: 'assistant', text: r.reply, chips: [...new Set(r.toolEvents.filter((e) => e.ok).map((e) => CHIP_LABEL[e.name] ?? e.name))] });
      setPending(r.pendingSubmission);
    } catch (e) {
      push({ role: 'error', text: e instanceof Error ? e.message : 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setWorking('Submitting…');
    try {
      const r = await api.agentConfirm(sessionId, pending.token);
      push({ role: 'assistant', text: r.reply, chips: [`Application ${r.lead.applicationId} filed`] });
      setPending(null);
      onFiled();
    } catch (e) {
      push({ role: 'error', text: e instanceof Error ? e.message : 'Could not submit.' });
      if (e instanceof ApiError) setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!pending) return;
    setPending(null);
    try {
      const r = await api.agentCancel(sessionId);
      push({ role: 'assistant', text: r.reply });
    } catch {
      push({ role: 'assistant', text: 'Cancelled.' });
    }
  };

  const reset = () => {
    setSessionId(newSession());
    setMsgs([WELCOME]);
    setPending(null);
    setInput('');
  };

  return (
    <>
      {!open && (
        <button
          className="btn btn-gold fixed bottom-4 right-4 z-30 rounded-full px-5 py-3 shadow-lg"
          onClick={() => setOpen(true)}
          aria-label="Open Loan Assist chat"
        >
          <span aria-hidden>💬</span> Loan Assist
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Loan Assist chat"
          className="fixed inset-0 z-40 flex flex-col bg-white sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[620px] sm:max-h-[calc(100vh-2rem)] sm:w-[400px] sm:rounded-2xl sm:border sm:border-stone-300 sm:shadow-2xl"
        >
          <header className="flex items-center justify-between rounded-t-2xl bg-forest-800 px-4 py-3 text-white">
            <div>
              <h2 className="font-bold">Loan Assist</h2>
              <p className="text-xs text-white/70">AI assistant · gold loans only</p>
            </div>
            <div className="flex gap-1">
              <button className="min-h-10 rounded-md px-3 text-sm hover:bg-white/10" onClick={reset}>
                New chat
              </button>
              <button className="min-h-10 min-w-10 rounded-md text-lg hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close chat">
                ✕
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-stone-50 p-4" role="log" aria-live="polite" aria-label="Conversation">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-snug ${
                    m.role === 'user'
                      ? 'rounded-br-sm bg-forest-800 text-white'
                      : m.role === 'error'
                        ? 'rounded-bl-sm border border-red-300 bg-red-50 text-red-800'
                        : 'rounded-bl-sm border border-stone-200 bg-white'
                  }`}
                >
                  {m.text}
                  {m.chips && m.chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.chips.map((c) => (
                        <span key={c} className="rounded-full bg-forest-50 px-2 py-0.5 text-[11px] font-medium text-forest-800">
                          ✓ {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <span className="rounded-full bg-gold-100 px-3 py-1 text-xs font-medium text-gold-700" role="status">
                  {working}
                </span>
              </div>
            )}

            {pending && (
              <div className="rounded-2xl border-2 border-gold-500 bg-white p-4 shadow-sm" role="group" aria-label="Application summary, confirmation needed">
                <h3 className="mb-2 font-bold">Please review and confirm</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <Row k="Name" v={pending.summary.name} />
                  <Row k="Mobile" v={pending.summary.mobileNumber} />
                  <Row k="Gold" v={`${pending.summary.netWeightGrams} g net / ${pending.summary.grossWeightGrams} g gross, ${pending.summary.karat}K`} />
                  <Row k="Pure gold" v={`${pending.summary.pureGoldGrams} g`} />
                  <Row k="Gold value" v={formatRupees(pending.summary.goldValueRupees)} />
                  <Row k="Plan" v={pending.summary.planName} />
                  <Row k="Rate" v={`${pending.summary.annualInterestRate}% p.a., ${pending.summary.tenureMonths} months`} />
                  <Row k="Eligible loan" v={formatRupees(pending.summary.eligibleLoanRupees)} strong />
                </dl>
                <p className="mt-2 text-xs text-stone-500">Nothing is submitted until you press Confirm.</p>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary flex-1" onClick={confirm} disabled={busy}>
                    Confirm and submit
                  </button>
                  <button className="btn btn-secondary" onClick={cancel} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex gap-2 border-t border-stone-200 bg-white p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              Message Loan Assist
            </label>
            <input
              id="chat-input"
              ref={inputRef}
              className="field-input flex-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message…"
              maxLength={1000}
              autoComplete="off"
              disabled={busy}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
  <>
    <dt className="text-stone-500">{k}</dt>
    <dd className={strong ? 'font-bold text-forest-800' : 'font-medium'}>{v}</dd>
  </>
);
