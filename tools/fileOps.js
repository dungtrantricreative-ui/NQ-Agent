import fs from 'fs/promises';
import path from 'path';

const SANDBOX_DIR = '/tmp/agent-sandbox';

function safePath(filename) {
  const resolved = path.resolve(SANDBOX_DIR, filename);
  if (!resolved.startsWith(SANDBOX_DIR)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

export async function writeFile(filename, content) {
  const filePath = safePath(filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
  return { success: true, filename };
}

export async function readFile(filename) {
  const filePath = safePath(filename);
  const content = await fs.readFile(filePath, 'utf-8');
  return { content: content.slice(0, 5000) };
}
