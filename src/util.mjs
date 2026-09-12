import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  config: (f) => path.join(ROOT, 'config', f),
  posts: path.join(ROOT, 'content', 'posts'),
  data: path.join(ROOT, 'data'),
  state: path.join(ROOT, 'data', 'state.json'),
  dist: path.join(ROOT, 'dist'),
  site: path.join(ROOT, 'site'),
};

export function loadConfig(name) {
  // BOM abschneiden: Windows-Editoren schreiben ihn gern in JSON-Dateien,
  // und JSON.parse stolpert darueber.
  const raw = fs.readFileSync(paths.config(name), 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`config/${name} ist kein gueltiges JSON: ${err.message}`);
  }
}

export function loadState() {
  if (!fs.existsSync(paths.state)) return { published: [], usedTopics: [], lastRun: null };
  return JSON.parse(fs.readFileSync(paths.state, 'utf8'));
}

export function saveState(state) {
  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(paths.state, JSON.stringify(state, null, 2) + '\n');
}

const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

export function slugify(s) {
  return s
    .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUTS[c])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Sehr kleines Frontmatter-Format: key: value, eine Zeile pro Feld.
// Absichtlich kein YAML-Parser, damit das Projekt ohne Abhaengigkeiten laeuft.

export function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };

  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, '');
    }
    meta[key] = value;
  }
  return { meta, body: m[2].trim() };
}

export function serializeFrontmatter(meta, body) {
  const lines = Object.entries(meta).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`
  );
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

export function readPosts() {
  if (!fs.existsSync(paths.posts)) return [];
  return fs
    .readdirSync(paths.posts)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(paths.posts, f), 'utf8'));
      return { file: f, slug: meta.slug || f.replace(/\.md$/, ''), meta, body };
    })
    .sort((a, b) => String(b.meta.date).localeCompare(String(a.meta.date)));
}

export function log(step, msg) {
  process.stdout.write(`[${step}] ${msg}\n`);
}
