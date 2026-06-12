'use client';
import type { LLMCall } from '@/lib/types';

/**
 * LLM observability dashboard (Feature 7) — last 14 days of llm_calls.
 * Charts are hand-rolled SVG: no chart dependency needed for bars.
 */

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-panel border border-border rounded-xl p-4 animate-fade-in-up">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="text-xl font-semibold mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function BarBreakdown({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="bg-panel border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium mb-3">{title}</h2>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-xs text-muted">No data yet.</p>}
        {rows.map(r => (
          <div key={r.label} className="text-xs">
            <div className="flex justify-between mb-1">
              <span className="text-muted truncate mr-2">{r.label}</span>
              <span className="tabular-nums shrink-0">{r.value.toLocaleString()}</span>
            </div>
            <div className="h-1.5 bg-bg rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokensPerDayChart({ calls }: { calls: LLMCall[] }) {
  // last 14 days, oldest → newest
  const days: { key: string; label: string; tokens: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }),
      tokens: 0,
    });
  }
  const byKey = new Map(days.map(d => [d.key, d]));
  for (const c of calls) {
    const day = byKey.get(c.created_at.slice(0, 10));
    if (day) day.tokens += c.tokens_in + c.tokens_out;
  }
  const max = Math.max(...days.map(d => d.tokens), 1);

  const W = 560, H = 140, PAD = 4;
  const bw = (W - PAD * 2) / days.length;

  return (
    <div className="bg-panel border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium mb-3">Tokens per day (14d)</h2>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full">
        {days.map((d, i) => {
          const h = Math.max((d.tokens / max) * H, d.tokens > 0 ? 3 : 1);
          return (
            <g key={d.key}>
              <rect
                x={PAD + i * bw + 2} y={H - h} width={bw - 4} height={h} rx={3}
                className={d.tokens > 0 ? 'fill-accent' : 'fill-border'}
              >
                <title>{`${d.label}: ${d.tokens.toLocaleString()} tokens`}</title>
              </rect>
              {i % 2 === 0 && (
                <text x={PAD + i * bw + bw / 2} y={H + 13} textAnchor="middle"
                  className="fill-muted" fontSize="9">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function AnalyticsClient({ calls }: { calls: LLMCall[] }) {
  const tokensIn = calls.reduce((a, c) => a + c.tokens_in, 0);
  const tokensOut = calls.reduce((a, c) => a + c.tokens_out, 0);
  const cost = calls.reduce((a, c) => a + Number(c.cost_usd), 0);
  const okCalls = calls.filter(c => c.ok);
  const avgLatency = okCalls.length ? Math.round(okCalls.reduce((a, c) => a + c.latency_ms, 0) / okCalls.length) : 0;

  const sumBy = (key: (c: LLMCall) => string) => {
    const m = new Map<string, number>();
    for (const c of calls) m.set(key(c), (m.get(key(c)) ?? 0) + c.tokens_in + c.tokens_out);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-lg font-semibold">Analytics</h1>
          <p className="text-[11px] text-muted">LLM usage — last 14 days</p>
        </div>
        <a href="/" className="text-xs text-muted hover:text-text transition-colors">← Dashboard</a>
      </header>

      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="LLM calls" value={calls.length.toLocaleString()}
            sub={`${calls.length - okCalls.length} failed`} />
          <StatCard label="Tokens" value={(tokensIn + tokensOut).toLocaleString()}
            sub={`${tokensIn.toLocaleString()} in · ${tokensOut.toLocaleString()} out`} />
          <StatCard label="Avg latency" value={`${avgLatency.toLocaleString()}ms`} />
          <StatCard label="Est. cost" value={`$${cost.toFixed(4)}`} sub="at list price — free tier pays $0" />
        </div>

        <TokensPerDayChart calls={calls} />

        <div className="grid sm:grid-cols-2 gap-3">
          <BarBreakdown title="Tokens by purpose" rows={sumBy(c => c.purpose ?? 'other')} />
          <BarBreakdown title="Tokens by model" rows={sumBy(c => c.model)} />
        </div>

        {calls.length === 0 && (
          <p className="text-center text-xs text-muted py-8">
            No LLM calls recorded yet. Run the agent (<code className="text-text">npm run agent:run</code>) and
            check back — every planning, recovery, and summary call lands here.
          </p>
        )}
      </div>
    </main>
  );
}
