// Umgebungscheck. Sagt dir, ob die Pipeline ueberhaupt laufen kann.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { detectProvider } from './llm.mjs';
import { paths, loadConfig } from './util.mjs';

const ok = (m) => process.stdout.write(`  ok    ${m}\n`);
const bad = (m) => process.stdout.write(`  fehlt ${m}\n`);

process.stdout.write('\nUmgebung\n');
ok(`Node ${process.version}`);

const provider = detectProvider();
process.stdout.write(`\nModellzugang (aktiv: ${provider})\n`);

if (provider === 'claude-cli') {
  const bin = process.env.CLAUDE_BIN || 'claude';
  try {
    const v = execSync(`"${bin}" --version`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    ok(`Claude-CLI: ${v}`);
  } catch {
    bad('Claude-CLI nicht aufrufbar. Installieren: npm install -g @anthropic-ai/claude-code');
  }
} else {
  if (process.env.ANTHROPIC_API_KEY) ok('ANTHROPIC_API_KEY gesetzt');
  else bad('ANTHROPIC_API_KEY nicht gesetzt');
  try {
    await import('@anthropic-ai/sdk');
    ok('SDK @anthropic-ai/sdk installiert');
  } catch {
    bad('SDK fehlt. Installieren: npm install @anthropic-ai/sdk');
  }
}

process.stdout.write('\nKonfiguration\n');
for (const f of ['site.json', 'niche.json', 'sources.json', 'affiliate.json']) {
  try {
    loadConfig(f);
    ok(`config/${f}`);
  } catch (e) {
    bad(`config/${f}: ${e.message}`);
  }
}

process.stdout.write('\nFeeds\n');
const sources = loadConfig('sources.json');
for (const s of sources.rss) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(s.url, { signal: ctrl.signal, headers: { 'user-agent': 'contentbot/1.0' } });
    clearTimeout(t);
    if (res.ok) ok(`${s.name} (HTTP ${res.status})`);
    else bad(`${s.name} (HTTP ${res.status})`);
  } catch (e) {
    bad(`${s.name} (${e.message})`);
  }
}

process.stdout.write('\nInhalte\n');
const count = fs.existsSync(paths.posts)
  ? fs.readdirSync(paths.posts).filter((f) => f.endsWith('.md')).length
  : 0;
ok(`${count} Beitraege in content/posts`);
process.stdout.write('\n');
