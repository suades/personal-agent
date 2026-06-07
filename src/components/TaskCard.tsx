'use client';
import { useState } from 'react';
import type { Task } from '@/lib/types';

export default function TaskCard({
  task,
  children,
}: {
  task: Task;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-panel border border-border rounded-xl p-3">
      <div className="flex items-start gap-3">
        <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded priority-${task.priority}`}>
          {task.priority[0]}
        </span>
        <div className="flex-1 min-w-0">
          <button onClick={() => setOpen(o => !o)} className="text-left w-full">
            <p className="text-sm font-medium leading-snug">{task.title}</p>
            {task.description && open && (
              <p className="text-xs text-muted mt-1 whitespace-pre-wrap">{task.description}</p>
            )}
          </button>
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
