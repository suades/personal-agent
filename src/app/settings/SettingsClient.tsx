'use client';
import type { Connector } from '@/lib/types';

const CONNECTORS: { name: string; label: string; setupUrl: string; description: string }[] = [
  { name: 'gmail',    label: 'Gmail',    setupUrl: '/api/connectors/google/start?scope=gmail',    description: 'Send and read emails.' },
  { name: 'calendar', label: 'Calendar', setupUrl: '/api/connectors/google/start?scope=calendar', description: 'Create and read calendar events.' },
];

export default function SettingsClient({ connectors }: { connectors: Connector[] }) {
  const map = new Map(connectors.map(c => [c.name, c]));

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <a href="/" className="text-xs text-muted hover:text-text">← Back</a>
      </header>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted mb-2">Connected tools</h2>
        <div className="space-y-2">
          {CONNECTORS.map(c => {
            const conn = map.get(c.name);
            const ok = conn?.status === 'connected';
            return (
              <div key={c.name} className="bg-panel border border-border rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{c.label} {ok && <span className="text-green-400 text-xs ml-1">✓ connected</span>}</p>
                  <p className="text-xs text-muted">{c.description}</p>
                </div>
                <a href={c.setupUrl}
                  className={`text-xs px-3 py-1.5 rounded-lg ${ok ? 'bg-bg border border-border' : 'bg-accent text-white'}`}>
                  {ok ? 'Reconnect' : 'Connect'}
                </a>
              </div>
            );
          })}
          <div className="bg-panel border border-border rounded-xl p-4">
            <p className="text-sm font-medium">Web Search <span className="text-green-400 text-xs ml-1">✓ built-in</span></p>
            <p className="text-xs text-muted">Brave Search — configured via environment.</p>
          </div>
          <div className="bg-panel border border-border rounded-xl p-4">
            <p className="text-sm font-medium">Browser Automation <span className="text-green-400 text-xs ml-1">✓ built-in</span></p>
            <p className="text-xs text-muted">Playwright — runs alongside the agent. No setup needed.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
