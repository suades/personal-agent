/**
 * LLM client with automatic fallback.
 * Priority: Groq (fast, reliable free tier) → OpenRouter (many models).
 * Set GROQ_API_KEY for Groq. Set OPENROUTER_API_KEY for OpenRouter.
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
  headers: Record<string, string>;
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

async function callProvider(provider: Provider, messages: LLMMessage[], opts: { temperature?: number; jsonMode?: boolean }): Promise<string> {
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
  return json.choices?.[0]?.message?.content ?? '';
}

export async function llmChat(messages: LLMMessage[], opts: { temperature?: number; jsonMode?: boolean } = {}): Promise<string> {
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
export async function llmJson<T = unknown>(messages: LLMMessage[]): Promise<T> {
  const raw = await llmChat(messages, { jsonMode: true });
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
