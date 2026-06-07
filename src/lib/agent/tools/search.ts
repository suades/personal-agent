export interface SearchResult { title: string; url: string; description: string; }

export async function braveSearch(query: string, count = 5): Promise<SearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY not set');
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
  const json = await res.json();
  return (json.web?.results ?? []).slice(0, count).map((r: { title: string; url: string; description: string }) => ({
    title: r.title, url: r.url, description: r.description,
  }));
}
