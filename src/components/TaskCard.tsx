'use client';
import { useState } from 'react';
import type { Task } from '@/lib/types';

function confidenceColor(c: number) {
  if (c >= 75) return 'text-low';
  if (c >= 50) return 'text-medium';
  return 'text-high';
}

export default function TaskCard({
  task,
  children,
  expandableContent,
  isSubtask = false,
  defaultOpen = false,
}: {
  task: Task;
  children?: React.ReactNode;
  expandableContent?: React.ReactNode;
  isSubtask?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = Boolean(task.description || expandableContent);

  return (
    <div className={`bg-panel border border-border rounded-xl p-3 sm:p-4 card-hover animate-fade-in-up edge-${task.priority}`}>
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <button
            onClick={() => expandable && setOpen(o => !o)}
            className={`text-left w-full flex items-start gap-2 ${expandable ? '' : 'cursor-default'}`}
          >
            {expandable && (
              <span className={`text-muted text-[10px] mt-1 shrink-0 inline-block transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
                ▶
              </span>
            )}
            <span className="text-sm font-medium leading-snug flex-1 min-w-0 break-words">{task.title}</span>
          </button>

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className={`text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded priority-${task.priority}`}>
              {task.priority}
            </span>
            {isSubtask && (
              <span className="text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-panel2 text-muted border border-border">
                subtask
              </span>
            )}
            {task.status === 'in_progress' && (
              <span className="flex items-center gap-1 text-[10px] text-accent">
                <span className="spinner" /> in progress
              </span>
            )}
            {task.agent_confidence != null && task.status !== 'queued' && (
              <span className={`text-[10px] font-medium ${confidenceColor(task.agent_confidence)}`}
                title="Agent's confidence at planning time">
                {task.agent_confidence}% confident
              </span>
            )}
          </div>

          {open && task.description && (
            <p className="text-xs text-muted mt-2 whitespace-pre-wrap animate-fade-in">{task.description}</p>
          )}
        </div>
      </div>

      {open && expandableContent && <div className="mt-3 animate-fade-in">{expandableContent}</div>}
      {children && <div className="mt-3 pt-2.5 border-t border-border/50">{children}</div>}
    </div>
  );
}
