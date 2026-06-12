'use client';

export type Tab = 'queue' | 'needsYou' | 'done';

export default function TabBar({
  tab, setTab, counts,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: { queue: number; needsYou: number; done: number };
}) {
  const tabs: { key: Tab; label: string; count: number; alert?: boolean }[] = [
    { key: 'queue',    label: 'Queue',     count: counts.queue },
    { key: 'needsYou', label: 'Needs You', count: counts.needsYou, alert: counts.needsYou > 0 },
    { key: 'done',     label: 'Done',      count: counts.done },
  ];
  return (
    <div className="flex gap-1 bg-panel border border-border rounded-xl p-1 sticky top-[64px] z-30 backdrop-blur">
      {tabs.map(t => (
        <button key={t.key} onClick={() => setTab(t.key)}
          className={`flex-1 py-2 text-sm rounded-lg transition-all duration-200 ${
            tab === t.key ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-text hover:bg-panel2'
          }`}>
          {t.label}
          {t.count > 0 && (
            <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
              tab === t.key ? 'bg-white/20' : t.alert ? 'bg-high/20 text-high' : 'bg-panel2'
            }`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
