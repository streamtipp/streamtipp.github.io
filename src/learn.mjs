// Lernschritt. Rechnet aus den gemessenen Klicks neue Gewichte fuer
// Artikelformen und Quellen aus. Die Themenfindung greift danach oefter zu
// dem, was tatsaechlich funktioniert.
//
// Zwei Sicherungen gegen Ueberreaktion:
//
//   1. Schwelle. Unter einer Mindestmenge an Daten bleibt alles wie in der
//      Konfiguration. Drei Klicks sind kein Trend.
//   2. Schrumpfung. Der Mittelwert jeder Gruppe wird in Richtung des
//      Gesamtmittels gezogen, gewichtet mit der Gruppengroesse. Ein einzelner
//      Glueckstreffer verschiebt damit wenig, zehn gleichartige Treffer viel.

import fs from 'node:fs';
import path from 'node:path';
import { paths, loadConfig, log } from './util.mjs';
import { loadPerformance } from './performance.mjs';

const WEIGHTS_FILE = path.join(paths.data, 'weights.json');

const MIN_MEASURED_ARTICLES = 10; // so viele Beitraege brauchen Daten
const MIN_TOTAL_CLICKS = 20;      // und so viele Klicks insgesamt
const SHRINK = 3;                 // Staerke der Schrumpfung, in Artikeln
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 5;

function groupBy(entries, key) {
  const groups = new Map();
  for (const e of entries) {
    const g = groups.get(e[key]) || { n: 0, clicks: 0, impressions: 0 };
    g.n += 1;
    g.clicks += e.clicks;
    g.impressions += e.impressions;
    groups.set(e[key], g);
  }
  return groups;
}

function weightsFor(groups, globalMean) {
  const shrunk = new Map();
  for (const [name, g] of groups) {
    shrunk.set(name, (g.clicks + SHRINK * globalMean) / (g.n + SHRINK));
  }

  const best = Math.max(...shrunk.values());
  if (!(best > 0)) return null;

  const out = {};
  for (const [name, value] of shrunk) {
    const scaled = MIN_WEIGHT + (MAX_WEIGHT - MIN_WEIGHT) * (value / best);
    out[name] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, Math.round(scaled)));
  }
  return out;
}

export function learn() {
  const perf = loadPerformance();
  if (!perf) {
    log('lernen', 'Noch keine Messdaten. Gewichte bleiben wie konfiguriert.');
    return null;
  }

  const measured = perf.entries.filter((e) => e.measured);

  if (measured.length < MIN_MEASURED_ARTICLES || perf.totalClicks < MIN_TOTAL_CLICKS) {
    log(
      'lernen',
      `Datenbasis zu duenn (${measured.length}/${MIN_MEASURED_ARTICLES} Beitraege, ` +
      `${perf.totalClicks}/${MIN_TOTAL_CLICKS} Klicks). Gewichte unveraendert.`
    );
    return null;
  }

  const globalMean = perf.totalClicks / measured.length;
  const formats = weightsFor(groupBy(measured, 'format'), globalMean);
  const sources = weightsFor(groupBy(measured, 'source'), globalMean);

  if (!formats && !sources) {
    log('lernen', 'Keine Gruppe mit Klicks. Gewichte unveraendert.');
    return null;
  }

  const weights = {
    updatedAt: new Date().toISOString(),
    basedOn: { articles: measured.length, clicks: perf.totalClicks },
    formats: formats || {},
    sources: sources || {},
  };

  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(weights, null, 2) + '\n');

  const fmt = Object.entries(weights.formats).sort((a, b) => b[1] - a[1]);
  log('lernen', `Neue Gewichte aus ${measured.length} Beitraegen und ${perf.totalClicks} Klicks.`);
  for (const [name, w] of fmt) log('lernen', `  ${name}: ${w}`);

  return weights;
}

export function loadWeights() {
  if (!fs.existsSync(WEIGHTS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// Gelernte Gewichte gewinnen, wo vorhanden. Fuer alles andere gilt weiter die
// Konfiguration, damit neu hinzugefuegte Formen oder Quellen nicht auf null
// fallen, nur weil es zu ihnen noch keine Daten gibt.

export function effectiveFormats() {
  const niche = loadConfig('niche.json');
  const learned = loadWeights();
  if (!learned) return niche.formats;
  return niche.formats.map((f) => ({ ...f, weight: learned.formats[f.id] ?? f.weight }));
}

export function effectiveSources() {
  const sources = loadConfig('sources.json');
  const learned = loadWeights();
  if (!learned) return sources.rss;
  return sources.rss.map((s) => ({ ...s, weight: learned.sources[s.name] ?? s.weight }));
}
