'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Preference } from '@/lib/types';

/**
 * Agent memory (Feature 13) — preferences the agent learned from completed
 * tasks, injected into every planning prompt. Editable so bad memories can be
 * corrected or removed.
 */
export default function PreferencesClient({ initial, userId }: { initial: Preference[]; userId: string }) {
  const [prefs, setPrefs] = useState(initial);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function addPref(e: React.FormEvent) {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    setBusy(true);
    const { data } = await supabaseBrowser().from('preferences').upsert({
      user_id: userId,
      key: newKey.trim().toLowerCase().replace(/\s+/g, '_'),
      value: newValue.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,key' }).select().single();
    if (data) setPrefs(p => [data as Preference, ...p.filter(x => x.id !== (data as Preference).id)]);
    setNewKey(''); setNewValue('');
    setBusy(false);
  }

  async function remove(id: string) {
    await supabaseBrowser().from('preferences').delete().eq('id', id);
    setPrefs(p => p.filter(x => x.id !== id));
  }

  async function save(id: string, value: string) {
    await supabaseBrowser().from('preferences').update({ value, updated_at: new Date().toISOString() }).eq('id', id);
    setPrefs(p => p.map(x => x.id === id ? { ...x, value } : x));
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-lg font-semibold">Agent Memory</h1>
          <p className="text-[11px] text-muted">Preferences the agent learned — used in every plan</p>
        </div>
        <a href="/" className="text-xs text-muted hover:text-text transition-colors">← Dashboard</a>
      </header>

      <form onSubmit={addPref} className="bg-panel border border-border rounded-xl p-4 mb-4 space-y-2 animate-fade-in-up">
        <p className="text-xs font-medium">Teach the agent something</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="preferred_shopping_site"
            className="sm:w-2/5 bg-bg border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-accent" />
          <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Amazon — never eBay"
            className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-accent" />
          <button type="submit" disabled={busy || !newKey.trim() || !newValue.trim()}
            className="bg-accent hover:bg-accent/90 text-white rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-50 transition-colors">
            Add
          </button>
        </div>
      </form>

      {prefs.length === 0 ? (
        <div className="text-center py-12 text-muted animate-fade-in">
          <p className="text-4xl mb-3">🧠</p>
          <p className="text-sm">Nothing learned yet.</p>
          <p className="text-xs text-muted/70 mt-1">The agent extracts preferences automatically as it completes tasks.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {prefs.map(p => <PrefRow key={p.id} pref={p} onRemove={remove} onSave={save} />)}
        </div>
      )}
    </main>
  );
}

function PrefRow({ pref, onRemove, onSave }: {
  pref: Preference;
  onRemove: (id: string) => void;
  onSave: (id: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pref.value);

  return (
    <div className="bg-panel border border-border rounded-xl p-3 card-hover animate-fade-in-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-mono text-accent break-all">{pref.key}</p>
          {editing ? (
            <div className="flex gap-2 mt-1.5">
              <input autoFocus value={value} onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { onSave(pref.id, value); setEditing(false); } }}
                className="flex-1 bg-bg border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-accent" />
              <button onClick={() => { onSave(pref.id, value); setEditing(false); }}
                className="text-[11px] bg-accent text-white px-2 rounded-lg">Save</button>
            </div>
          ) : (
            <p className="text-xs text-text mt-1 break-words">{pref.value}</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0 text-[11px]">
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-muted hover:text-text transition-colors">Edit</button>
          )}
          <button onClick={() => onRemove(pref.id)} className="text-muted hover:text-red-400 transition-colors">Forget</button>
        </div>
      </div>
    </div>
  );
}
