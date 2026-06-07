'use client';

export type Tab = 'queue' | 'needsYou' | 'done';

export default function TabBar({
  tab, setTab, counts,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: { queue: number; needsYou: number; done: number };
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'queue',    label: 'Queue',     count: counts.queue },
    { key: 'needsYou', label: 'Needs You', count: counts.needsYou },
    { key: 'done',     label: 'Done',      count: counts.done },
  ];
  return (
    <div className="flex gap-1 bg-panel border border-border rounded-xl p-1">
      {tabs.map(t => (
        <button key={t.key} onClick={() => setTab(t.key)}
          className={`flex-1 py-2 text-sm rounded-lg transition ${
            tab === t.key ? 'bg-accent text-white' : 'text-muted hover:text-text'
          }`}>
          {t.label}
          {t.count > 0 && <span className="ml-1.5 text-xs opacity-75">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}
