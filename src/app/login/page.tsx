'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message); else setSent(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-panel border border-border rounded-2xl p-8">
        <h1 className="text-2xl font-semibold mb-1">ToDo Agent</h1>
        <p className="text-muted text-sm mb-6">Drop tasks. Agent does them at night.</p>

        {sent ? (
          <div className="text-sm">
            <p className="text-green-400 mb-2">✓ Check your inbox.</p>
            <p className="text-muted">We sent a magic link to <strong>{email}</strong>. Tap it on this device to sign in.</p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
            <button
              type="submit" disabled={loading}
              className="w-full bg-accent text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <p className="text-red-400 text-xs">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
