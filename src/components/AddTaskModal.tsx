'use client';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Priority } from '@/lib/types';

type Mode = 'smart' | 'manual';

export default function AddTaskModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('smart');
  const [smartText, setSmartText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedHint, setParsedHint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [busy, setBusy] = useState(false);

  // ── voice input (browser-native Web Speech API) ──
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const speechSupported = typeof window !== 'undefined' &&
    Boolean((window as unknown as Record<string, unknown>).webkitSpeechRecognition ||
      (window as unknown as Record<string, unknown>).SpeechRecognition);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as new () => {
        lang: string; interimResults: boolean; continuous: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onend: () => void; onerror: () => void;
        start: () => void; stop: () => void;
      };
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('');
      setSmartText(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function smartParse(e: React.FormEvent) {
    e.preventDefault();
    if (!smartText.trim()) return;
    setParsing(true); setError(null);
    try {
      const res = await fetch('/api/tasks/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: smartText.trim() }),
      });
      if (!res.ok) throw new Error('Parsing failed — try Manual mode.');
      const parsed = await res.json();
      setTitle(parsed.title ?? smartText.trim());
      setDescription(parsed.description ?? '');
      setPriority(parsed.priority ?? 'medium');
      setParsedHint(true);
      setMode('manual'); // show the parsed result for review
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
    }
  }

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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 animate-fade-in"
      onClick={onClose}>
      <div className="bg-panel border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-sheet-up max-h-[85dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="sm:hidden w-10 h-1 rounded-full bg-border mx-auto -mt-1 mb-3" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New task</h2>
          <div className="flex bg-bg border border-border rounded-lg p-0.5 text-xs">
            {(['smart', 'manual'] as Mode[]).map(m => (
              <button key={m} onClick={() => { setMode(m); setParsedHint(false); }}
                className={`px-3 py-1 rounded-md transition-colors ${mode === m ? 'bg-accent text-white' : 'text-muted hover:text-text'}`}>
                {m === 'smart' ? '✨ Smart' : 'Manual'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'smart' ? (
          <form onSubmit={smartParse} className="space-y-3">
            <div className="relative">
              <textarea autoFocus rows={4}
                placeholder={'Just describe it…\n"Find me a cheap flight to Miami next month — high priority"'}
                value={smartText} onChange={e => setSmartText(e.target.value)}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:border-accent resize-none" />
              {speechSupported && (
                <button type="button" onClick={toggleVoice} title={listening ? 'Stop dictation' : 'Dictate'}
                  className={`absolute right-2 top-2 text-lg transition-transform hover:scale-110 ${listening ? 'animate-pulse-soft' : ''}`}>
                  {listening ? '🔴' : '🎤'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted">
              The agent extracts the title, details, and priority for you.
            </p>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 bg-bg border border-border rounded-lg py-2.5 text-sm transition-colors hover:border-muted">Cancel</button>
              <button type="submit" disabled={parsing || !smartText.trim()}
                className="flex-1 bg-accent hover:bg-accent/90 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
                {parsing ? 'Parsing…' : 'Parse →'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {parsedHint && (
              <p className="text-[11px] text-low animate-fade-in">✓ Parsed — review and tweak before adding.</p>
            )}
            <input autoFocus required placeholder="What needs to get done?"
              value={title} onChange={e => setTitle(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
            <textarea placeholder="Details / context for the agent (optional)" rows={4}
              value={description} onChange={e => setDescription(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none" />
            <div className="flex gap-2">
              {(['high', 'medium', 'low'] as Priority[]).map(p => (
                <button type="button" key={p} onClick={() => setPriority(p)}
                  className={`flex-1 py-2 text-xs uppercase rounded-lg border transition-all ${
                    priority === p ? `priority-${p} border-transparent scale-[1.02]` : 'bg-bg border-border text-muted hover:border-muted'
                  }`}>{p}</button>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 bg-bg border border-border rounded-lg py-2.5 text-sm transition-colors hover:border-muted">Cancel</button>
              <button type="submit" disabled={busy}
                className="flex-1 bg-accent hover:bg-accent/90 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
                {busy ? 'Adding…' : 'Add Task'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
