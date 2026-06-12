/**
 * Text embeddings for semantic workflow matching (Feature 10).
 *
 * Provider chain (all free tiers, no new npm deps):
 *   1. Google Gemini `text-embedding-004`  — set GEMINI_API_KEY
 *   2. Jina `jina-embeddings-v3`           — set JINA_API_KEY
 *   3. None configured → returns null and callers fall back to keyword matching.
 *
 * Vectors are stored as plain JSON number[] (workflows.embedding JSONB) and
 * compared with cosine similarity in JS — a single user has few workflows, so
 * pgvector would be overkill.
 */

export function embeddingsAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.JINA_API_KEY);
}

export async function embedText(text: string): Promise<number[] | null> {
  const input = text.slice(0, 6000); // both APIs cap input length
  try {
    if (process.env.GEMINI_API_KEY) return await embedGemini(input);
    if (process.env.JINA_API_KEY) return await embedJina(input);
  } catch (e) {
    console.warn('[embeddings] failed, falling back to keywords:', (e as Error).message.slice(0, 120));
  }
  return null;
}

async function embedGemini(text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text }] } }),
    },
  );
  if (!res.ok) throw new Error(`Gemini embeddings ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const values = json.embedding?.values;
  if (!Array.isArray(values)) throw new Error('Gemini embeddings: unexpected response shape');
  return values as number[];
}

async function embedJina(text: string): Promise<number[]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
    },
    body: JSON.stringify({ model: 'jina-embeddings-v3', task: 'text-matching', input: [text] }),
  });
  if (!res.ok) throw new Error(`Jina embeddings ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const values = json.data?.[0]?.embedding;
  if (!Array.isArray(values)) throw new Error('Jina embeddings: unexpected response shape');
  return values as number[];
}

export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
