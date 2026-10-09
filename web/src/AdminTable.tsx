import { useCallback, useEffect, useState } from 'react';
import { api, type LeadsPage, type Scheme } from './api';
import { formatDateTime, formatRupees } from './format';

const STATUS_STYLE: Record<string, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-800',
  UNDER_REVIEW: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
};

export function AdminTable({ refreshKey }: { refreshKey: number }) {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [planId, setPlanId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeadsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pageSize = 10;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .leads({ page, pageSize, planId: planId || undefined })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, planId]);

  useEffect(() => {
    api.schemes().then(setSchemes).catch(() => undefined);
  }, []);
  useEffect(load, [load, refreshKey]);

  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Applications</h2>
          <p className="text-sm text-stone-500">Newest first. Mobile numbers are masked.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="plan-filter" className="mb-1 block text-xs font-medium text-stone-600">
              Plan
            </label>
            <select
              id="plan-filter"
              className="field-input"
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All plans</option>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Loan applications, newest first</caption>
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th scope="col" className="px-4 py-2 sm:px-2">ID</th>
              <th scope="col" className="px-2 py-2">Name</th>
              <th scope="col" className="px-2 py-2">Mobile</th>
              <th scope="col" className="px-2 py-2 text-right">Net wt</th>
              <th scope="col" className="px-2 py-2">Plan</th>
              <th scope="col" className="px-2 py-2 text-right">Loan</th>
              <th scope="col" className="px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50' : ''}>
            {data?.data.map((l) => (
              <tr key={l.applicationId} className="border-b border-stone-100">
                <td className="whitespace-nowrap px-4 py-2 font-semibold sm:px-2">
                  {l.applicationId}
                  <span className="block text-xs font-normal text-stone-400">{formatDateTime(l.createdAt)}</span>
                </td>
                <td className="px-2 py-2">
                  {l.name}
                  {l.source === 'AGENT' && <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">AI</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-2 font-mono">{l.mobileNumber}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  {l.netWeightGrams} g <span className="text-stone-400">· {l.karat}K</span>
                </td>
                <td className="px-2 py-2">{l.planName}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{formatRupees(l.eligibleLoanRupees)}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[l.status] ?? 'bg-stone-100'}`}>{l.status.replace('_', ' ')}</span>
                </td>
              </tr>
            ))}
            {data && data.data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-8 text-center text-stone-500">
                  No applications yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-stone-500">{data ? `${data.total} total · page ${page} of ${pages}` : ' '}</span>
        <div className="flex gap-2">
          <button className="btn btn-secondary !min-h-10 !px-3" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <button className="btn btn-secondary !min-h-10 !px-3" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
