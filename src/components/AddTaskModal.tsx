'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Priority } from '@/lib/types';

export default function AddTaskModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const supabase = supabaseBrowser();
    await supabase.from('tasks').insert({
      user_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      status: 'queued',
    });
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-panel border border-border rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">New task</h2>
        <form onSubmit={submit} className="space-y-3">
          <input autoFocus required placeholder="What needs to get done?"
            value={title} onChange={e => setTitle(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          <textarea placeholder="Details / context for the agent (optional)" rows={4}
            value={description} onChange={e => setDescription(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none" />
          <div className="flex gap-2">
            {(['high', 'medium', 'low'] as Priority[]).map(p => (
              <button type="button" key={p} onClick={() => setPriority(p)}
                className={`flex-1 py-1.5 text-xs uppercase rounded-lg border ${
                  priority === p ? `priority-${p} border-transparent` : 'bg-bg border-border text-muted'
                }`}>{p}</button>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 bg-bg border border-border rounded-lg py-2 text-sm">Cancel</button>
            <button type="submit" disabled={busy}
              className="flex-1 bg-accent text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
              {busy ? 'Adding…' : 'Add Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
