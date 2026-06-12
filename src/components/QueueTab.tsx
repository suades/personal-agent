'use client';
import type { Task } from '@/lib/types';
import TaskCard from './TaskCard';
import { supabaseBrowser } from '@/lib/supabase/client';

function DeleteButton({ taskId }: { taskId: string }) {
  return (
    <div className="flex justify-end">
      <button
        onClick={async () => { await supabaseBrowser().from('tasks').delete().eq('id', taskId); }}
        className="text-xs text-muted hover:text-red-400 transition-colors">Delete</button>
    </div>
  );
}

export default function QueueTab({ tasks, onAdd }: { tasks: Task[]; onAdd: () => void }) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <p className="text-4xl mb-3">🌙</p>
        <p className="text-muted mb-1">No tasks queued.</p>
        <p className="text-xs text-muted/70 mb-5">Drop tasks here — the agent works through them overnight.</p>
        <button onClick={onAdd}
          className="bg-accent hover:bg-accent/90 text-white rounded-lg px-5 py-2.5 text-sm font-medium transition-colors">
          Add your first task
        </button>
      </div>
    );
  }

  // Subtasks render nested under their parent; orphaned subtasks (parent already
  // done/deleted) render at top level.
  const parentIds = new Set(tasks.map(t => t.id));
  const topLevel = tasks.filter(t => !t.parent_task_id || !parentIds.has(t.parent_task_id));
  const childrenOf = (id: string) =>
    tasks.filter(t => t.parent_task_id === id).sort((a, b) => a.sort_index - b.sort_index);

  const priorities: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'low'];
  // explicit classes — Tailwind can't see dynamically-built names
  const dotClass = { high: 'bg-high', medium: 'bg-medium', low: 'bg-low' } as const;
  return (
    <div className="space-y-5">
      {priorities.map(p => {
        const items = topLevel.filter(t => t.priority === p);
        if (items.length === 0) return null;
        return (
          <section key={p}>
            <h2 className="text-[11px] uppercase tracking-wider text-muted mb-2 px-1 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${dotClass[p]}`} />
              {p} priority
            </h2>
            <div className="space-y-2">
              {items.map(task => {
                const subs = childrenOf(task.id);
                return (
                  <div key={task.id}>
                    <TaskCard task={task}>
                      <DeleteButton taskId={task.id} />
                    </TaskCard>
                    {subs.length > 0 && (
                      <div className="ml-4 sm:ml-6 mt-2 space-y-2 border-l-2 border-border/60 pl-3">
                        {subs.map(sub => (
                          <TaskCard key={sub.id} task={sub} isSubtask>
                            <DeleteButton taskId={sub.id} />
                          </TaskCard>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
