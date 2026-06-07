import { supabaseAdmin } from '@/lib/supabase/server';

export interface ConnectorConfig {
  access_token?: string;
  refresh_token?: string;
  [key: string]: unknown;
}

const REQUIRED_FOR: Record<string, string[]> = {
  gmail:    ['gmail'],
  calendar: ['calendar'],
  search:   ['brave_search'],
  browser:  [],          // playwright needs no auth
  files:    [],          // local files need no auth
};

const BUILTIN_CONNECTED = new Set(['brave_search']);   // env-based, always available if key present

export async function getConnectorConfig(userId: string, name: string): Promise<ConnectorConfig | null> {
  const supabase = supabaseAdmin();
  const { data } = await supabase.from('connectors').select('config, status').eq('user_id', userId).eq('name', name).single();
  if (!data || data.status !== 'connected') return null;
  return data.config as ConnectorConfig;
}

export async function listAvailableConnectors(userId: string): Promise<Set<string>> {
  const supabase = supabaseAdmin();
  const { data } = await supabase.from('connectors').select('name, status').eq('user_id', userId);
  const set = new Set<string>(BUILTIN_CONNECTED);
  for (const c of data ?? []) if (c.status === 'connected') set.add(c.name);
  if (process.env.BRAVE_SEARCH_API_KEY) set.add('brave_search');
  // Playwright + files always available server-side
  set.add('browser');
  set.add('files');
  return set;
}

export function connectorsRequiredFor(tool: string): string[] {
  return REQUIRED_FOR[tool] ?? [];
}

export async function missingConnectorsForTools(userId: string, tools: string[]): Promise<string[]> {
  const available = await listAvailableConnectors(userId);
  const missing = new Set<string>();
  for (const tool of tools) {
    for (const req of connectorsRequiredFor(tool)) {
      if (!available.has(req)) missing.add(req);
    }
  }
  return [...missing];
}
