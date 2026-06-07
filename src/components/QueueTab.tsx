'use client';
import type { Task } from '@/lib/types';
import TaskCard from './TaskCard';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function QueueTab({ tasks, onAdd }: { tasks: Task[]; onAdd: () => void }) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted mb-4">No tasks queued yet.</p>
        <button onClick={onAdd} className="bg-accent text-white rounded-lg px-4 py-2 text-sm">Add your first task</button>
      </div>
    );
  }
  const priorities: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'low'];
  return (
    <div className="space-y-4">
      {priorities.map(p => {
        const items = tasks.filter(t => t.priority === p);
        if (items.length === 0) return null;
        return (
          <section key={p}>
            <h2 className="text-xs uppercase tracking-wider text-muted mb-2 px-1">{p}</h2>
            <div className="space-y-2">
              {items.map(task => (
                <TaskCard key={task.id} task={task}>
                  <div className="flex justify-end">
                    <button
                      onClick={async () => { await supabaseBrowser().from('tasks').delete().eq('id', task.id); }}
                      className="text-xs text-muted hover:text-red-400">Delete</button>
                  </div>
                </TaskCard>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
