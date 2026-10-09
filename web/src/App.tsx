import { useState } from 'react';
import { AdminTable } from './AdminTable';
import { ApplyFlow } from './ApplyFlow';
import { ChatPanel } from './ChatPanel';

type Tab = 'apply' | 'admin';

export default function App() {
  const [tab, setTab] = useState<Tab>('apply');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen">
      <header className="bg-forest-800 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-full bg-gold-500 text-lg" aria-hidden>
              ◎
            </span>
            <div className="leading-tight">
              <h1 className="text-lg font-bold">Gold Loan Portal</h1>
              <p className="text-xs text-white/70">Instant preliminary offers</p>
            </div>
          </div>
          <nav aria-label="Sections" className="flex rounded-lg bg-white/10 p-1">
            {(['apply', 'admin'] as const).map((t) => (
              <button
                key={t}
                aria-current={tab === t ? 'page' : undefined}
                onClick={() => {
                  setTab(t);
                  if (t === 'admin') setRefreshKey((k) => k + 1);
                }}
                className={`min-h-10 rounded-md px-3 text-sm font-semibold ${tab === t ? 'bg-white text-forest-900' : 'text-white/80 hover:text-white'}`}
              >
                {t === 'apply' ? 'Apply' : 'Admin'}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 pb-28">
        {tab === 'apply' ? <ApplyFlow /> : <AdminTable refreshKey={refreshKey} />}
      </main>

      <ChatPanel onFiled={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}
