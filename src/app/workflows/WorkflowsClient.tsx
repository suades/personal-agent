'use client';
import type { Workflow } from '@/lib/types';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function WorkflowsClient({ workflows }: { workflows: Workflow[] }) {
  async function del(id: string) {
    if (!confirm('Delete this workflow?')) return;
    await supabaseBrowser().from('workflows').delete().eq('id', id);
    location.reload();
  }
  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workflows</h1>
        <a href="/" className="text-xs text-muted hover:text-text">← Back</a>
      </header>
      <p className="text-sm text-muted mb-4">
        These are procedures the agent learned from you. The next time a task matches one of these,
        the agent runs the saved steps automatically.
      </p>
      {workflows.length === 0 ? (
        <p className="text-muted text-sm">No workflows learned yet. Add some tasks and the agent will save patterns it can reuse.</p>
      ) : (
        <div className="space-y-2">
          {workflows.map(wf => (
            <div key={wf.id} className="bg-panel border border-border rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">{wf.name}</p>
                  {wf.description && <p className="text-xs text-muted mt-0.5">{wf.description}</p>}
                  <p className="text-[11px] text-muted mt-1">
                    Triggers: {wf.trigger_keywords.join(', ') || '—'} · Used {wf.use_count}×
                  </p>
                </div>
                <button onClick={() => del(wf.id)} className="text-xs text-muted hover:text-red-400">Delete</button>
              </div>
              <details className="mt-2">
                <summary className="text-xs text-muted cursor-pointer">Show steps</summary>
                <pre className="text-[11px] text-muted bg-bg border border-border rounded p-2 mt-2 overflow-auto">
                  {JSON.stringify(wf.steps, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
