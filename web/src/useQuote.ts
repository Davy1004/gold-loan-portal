import { useEffect, useState } from 'react';
import { api, type Quote } from './api';
import type { FormValues } from './validation';
import { parseWeights } from './validation';

export const QUOTE_DEBOUNCE_MS = 300;

/** Re-quotes ~300 ms after the user stops typing. Stale in-flight requests are aborted. */
export function useQuote(values: FormValues) {
  const w = parseWeights(values);
  const key = w ? `${w.netWeightGrams}|${w.grossWeightGrams}|${w.karat}` : '';
  const [state, setState] = useState<{ quote: Quote | null; loading: boolean; error: string | null }>({
    quote: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!key || !w) {
      setState({ quote: null, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      api
        .quote(w, ctrl.signal)
        .then((quote) => setState({ quote, loading: false, error: null }))
        .catch((e: unknown) => {
          if ((e as { name?: string })?.name === 'AbortError' || (e as { code?: string })?.code === 'NETWORK' && ctrl.signal.aborted) return;
          setState({ quote: null, loading: false, error: e instanceof Error ? e.message : 'Could not get a quote' });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
