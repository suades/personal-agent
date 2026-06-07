import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Resolves a path that may use ~ for home dir. */
function resolvePath(p: string) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

export async function listFolder(folder: string): Promise<string[]> {
  const dir = resolvePath(folder);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => path.join(dir, e.name));
}

export async function readTextFile(file: string): Promise<string> {
  return await fs.readFile(resolvePath(file), 'utf8');
}

export async function writeTextFile(file: string, content: string) {
  const full = resolvePath(file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  return full;
}
