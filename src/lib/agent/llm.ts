/**
 * OpenRouter LLM client. Uses DeepSeek R1 (free) by default — swap via OPENROUTER_MODEL.
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function llmChat(messages: LLMMessage[], opts: { temperature?: number; jsonMode?: boolean } = {}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const model = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-r1:free';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://todo-agent.local',
      'X-Title': 'ToDo Agent',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
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
