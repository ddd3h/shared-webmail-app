import * as fs from 'fs';
import * as path from 'path';

const ENV_PATH = path.resolve(process.cwd(), '.env');

export function writeEnvValue(key: string, value: string): void {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf-8');
  } catch {
    // file doesn't exist, create fresh
  }

  const lines = content.split('\n');
  const quoted = value.includes('"') ? `'${value}'` : `"${value}"`;
  const newLine = `${key}=${quoted}`;

  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() === key) {
      lines[i] = newLine;
      found = true;
      break;
    }
  }

  if (!found) {
    if (content && !content.endsWith('\n')) lines.push('');
    lines.push(newLine);
  }

  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
}

export function writeEnvValues(updates: Record<string, string>): void {
  for (const [key, value] of Object.entries(updates)) {
    writeEnvValue(key, value);
  }
}
