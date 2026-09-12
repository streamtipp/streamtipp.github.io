// Erfolgsmessung. Liest einen CSV-Export aus der Google Search Console und
// ordnet Klicks und Impressionen den eigenen Beitraegen zu.
//
// Warum Search Console und kein Analyse-Skript auf der Seite: Die Daten
// entstehen bei Google, nicht im Browser des Lesers. Es wird nichts geladen,
// nichts gespeichert, kein Cookie gesetzt. Damit bleibt die Seite
// einwilligungsfrei und die Datenschutzerklaerung stimmt weiterhin.
//
// Export holen: Search Console oeffnen, Leistung, Seiten, Exportieren,
// CSV herunterladen, die Datei "Seiten.csv" nach data/ legen.

import fs from 'node:fs';
import path from 'node:path';
import { paths, loadConfig, readPosts, log } from './util.mjs';

const PERF_FILE = path.join(paths.data, 'performance.json');

// Die Spaltennamen unterscheiden sich je nach Sprache des Kontos.
const COLS = {
  url: ['oberste seiten', 'top pages', 'seite', 'page', 'url'],
  clicks: ['klicks', 'clicks'],
  impressions: ['impressionen', 'impressions'],
  position: ['position', 'durchschnittliche position', 'average position'],
};

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if ((c === ',' || c === ';' || c === '\t') && !quoted) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findColumn(header, candidates) {
  const lower = header.map((h) => h.toLowerCase().replace(/^﻿/, ''));
  for (const cand of candidates) {
    const i = lower.findIndex((h) => h === cand);
    if (i !== -1) return i;
  }
  for (const cand of candidates) {
    const i = lower.findIndex((h) => h.includes(cand));
    if (i !== -1) return i;
  }
  return -1;
}

function toNumber(s) {
  if (!s) return 0;
  // Deutsche Exporte nutzen Komma als Dezimaltrenner und Punkt als Tausender.
  const cleaned = s.replace(/\s|%/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function slugFromUrl(url, baseUrl) {
  try {
    const p = new URL(url, baseUrl).pathname.replace(/^\/+|\/+$/g, '');
    return p || '__index__';
  } catch {
    return null;
  }
}

export function ingestCsv(file) {
  const site = loadConfig('site.json');
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error(`${path.basename(file)} enthaelt keine Datenzeilen.`);

  const header = splitCsvLine(lines[0]);
  const iUrl = findColumn(header, COLS.url);
  const iClicks = findColumn(header, COLS.clicks);
  const iImpr = findColumn(header, COLS.impressions);
  const iPos = findColumn(header, COLS.position);

  if (iUrl === -1 || iClicks === -1) {
    throw new Error(`Spalten nicht erkannt in ${path.basename(file)}. Kopfzeile: ${header.join(' | ')}`);
  }

  const rows = {};
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const slug = slugFromUrl(cells[iUrl], site.baseUrl);
    if (!slug) continue;
    rows[slug] = {
      clicks: toNumber(cells[iClicks]),
      impressions: iImpr === -1 ? 0 : toNumber(cells[iImpr]),
      position: iPos === -1 ? null : toNumber(cells[iPos]) || null,
    };
  }
  return rows;
}

// Verbindet die gemessenen Zahlen mit den Merkmalen des Beitrags, damit
// spaeter nach Artikelform und Quelle ausgewertet werden kann.

export function buildPerformance(rows) {
  const posts = readPosts();
  const entries = [];

  for (const post of posts) {
    const m = rows[post.slug] || { clicks: 0, impressions: 0, position: null };
    entries.push({
      slug: post.slug,
      date: post.meta.date,
      format: post.meta.format || 'unbekannt',
      source: post.meta.source || 'unbekannt',
      tags: Array.isArray(post.meta.tags) ? post.meta.tags : [],
      clicks: m.clicks,
      impressions: m.impressions,
      position: m.position,
      measured: Object.prototype.hasOwnProperty.call(rows, post.slug),
    });
  }

  return {
    updatedAt: new Date().toISOString(),
    articles: entries.length,
    measured: entries.filter((e) => e.measured).length,
    totalClicks: entries.reduce((s, e) => s + e.clicks, 0),
    totalImpressions: entries.reduce((s, e) => s + e.impressions, 0),
    entries,
  };
}

export function savePerformance(perf) {
  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(PERF_FILE, JSON.stringify(perf, null, 2) + '\n');
}

export function loadPerformance() {
  if (!fs.existsSync(PERF_FILE)) return null;
  return JSON.parse(fs.readFileSync(PERF_FILE, 'utf8'));
}

// Sucht selbststaendig nach einem neuen Export in data/ und verarbeitet ihn.
// Gibt zurueck, ob etwas Neues gefunden wurde.

export function refreshFromExports() {
  if (!fs.existsSync(paths.data)) return false;

  const candidates = fs
    .readdirSync(paths.data)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .map((f) => ({ f, t: fs.statSync(path.join(paths.data, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  if (!candidates.length) return false;

  const newest = path.join(paths.data, candidates[0].f);
  try {
    const perf = buildPerformance(ingestCsv(newest));
    savePerformance(perf);
    log('messung', `${candidates[0].f}: ${perf.measured} von ${perf.articles} Beitraegen mit Daten, ${perf.totalClicks} Klicks`);
    return true;
  } catch (err) {
    log('messung', `${candidates[0].f} nicht verwertbar: ${err.message}`);
    return false;
  }
}
