/**
 * LLM client with automatic fallback + observability.
 * Priority: Groq (fast, reliable free tier) → OpenRouter (many models).
 * Set GROQ_API_KEY for Groq. Set OPENROUTER_API_KEY for OpenRouter.
 *
 * Every call is logged to the llm_calls table (model, tokens, latency, cost)
 * for the /analytics dashboard. Logging is fire-and-forget — it never blocks
 * or fails the actual completion.
 */
import { supabaseAdmin } from '@/lib/supabase/server';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOpts {
  temperature?: number;
  jsonMode?: boolean;
  /** Tag for analytics: plan | summarize | recovery | nlu | memory | workflow | decompose */
  purpose?: string;
}

interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
  headers: Record<string, string>;
}

// ── Call attribution ────────────────────────────────────────────
// Single-user app: the orchestrator (or API route) sets the current user once
// instead of threading userId through every call site.
let currentUserId: string | null = null;
export function setLLMUser(userId: string | null) {
  currentUserId = userId;
}

// USD per 1M tokens [input, output]. Free-tier models cost $0 out of pocket;
// the Groq numbers show what the usage *would* cost at list price.
const PRICE_PER_MTOK: Record<string, [number, number]> = {
  'llama-3.3-70b-versatile': [0.59, 0.79],
  'meta-llama/llama-3.3-70b-instruct:free': [0, 0],
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const [pin, pout] = PRICE_PER_MTOK[model] ?? [0, 0];
  return (tokensIn * pin + tokensOut * pout) / 1_000_000;
}

function recordCall(row: {
  provider: string; model: string; purpose?: string;
  tokens_in: number; tokens_out: number; latency_ms: number; ok: boolean;
}) {
  try {
    supabaseAdmin().from('llm_calls').insert({
      user_id: currentUserId,
      provider: row.provider,
      model: row.model,
      purpose: row.purpose ?? null,
      tokens_in: row.tokens_in,
      tokens_out: row.tokens_out,
      latency_ms: row.latency_ms,
      cost_usd: estimateCost(row.model, row.tokens_in, row.tokens_out),
      ok: row.ok,
    }).then(({ error }) => {
      if (error) console.warn('[llm-track] insert failed:', error.message);
    });
  } catch {
    // table missing / no service key — observability must never break the agent
  }
}

function getProviders(): Provider[] {
  const providers: Provider[] = [];

  // Groq — preferred (fast, generous free tier: 30 req/min)
  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    });
  }

  // OpenRouter — fallback
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: 'OpenRouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      key: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://todo-agent.local',
        'X-Title': 'ToDo Agent',
      },
    });
  }

  if (providers.length === 0) throw new Error('No LLM provider configured. Set GROQ_API_KEY or OPENROUTER_API_KEY.');
  return providers;
}

async function callProvider(provider: Provider, messages: LLMMessage[], opts: LLMOpts): Promise<string> {
  const t0 = Date.now();
  let ok = false;
  let tokensIn = 0, tokensOut = 0;
  try {
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: provider.headers,
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${provider.name} ${res.status}: ${text}`);
    }
    const json = await res.json();
    tokensIn = json.usage?.prompt_tokens ?? 0;
    tokensOut = json.usage?.completion_tokens ?? 0;
    ok = true;
    return json.choices?.[0]?.message?.content ?? '';
  } finally {
    recordCall({
      provider: provider.name,
      model: provider.model,
      purpose: opts.purpose,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: Date.now() - t0,
      ok,
    });
  }
}

export async function llmChat(messages: LLMMessage[], opts: LLMOpts = {}): Promise<string> {
  const providers = getProviders();
  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      return await callProvider(provider, messages, opts);
    } catch (e) {
      lastError = e as Error;
      console.warn(`[llm] ${provider.name} failed: ${lastError.message.slice(0, 100)}. Trying next...`);
    }
  }
  throw lastError ?? new Error('All LLM providers failed');
}

/** Forces JSON output even on models that don't honor response_format. */
export async function llmJson<T = unknown>(messages: LLMMessage[], opts: LLMOpts = {}): Promise<T> {
  const raw = await llmChat(messages, { ...opts, jsonMode: true });
  // strip code fences if model wraps in ```json
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // attempt to find first { ... } block
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error('LLM did not return valid JSON: ' + raw.slice(0, 200));
  }
}
