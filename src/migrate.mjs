// Einmalige Bereinigung des Bestands. Zwei Dinge, die mit jedem weiteren
// Artikel teurer zu reparieren waeren:
//
//   Themen  - Das Modell hatte freie Hand und erfand pro Artikel neue
//             Schlagworte. Aus 15 Beitraegen wurden 50 Einzelbegriffe.
//             Hier werden sie auf die feste Liste aus niche.json abgebildet.
//
//   Datum   - Alle Artikel eines Stapels tragen denselben Tag. Das sieht nach
//             Abladen aus und macht die Sortierung auf der Startseite
//             zufaellig. Hier werden sie rueckwaerts ueber die Tage verteilt.
//
// Die Adressen aendern sich nicht: Der Slug bleibt, nur Dateiname und das
// Feld date werden angefasst. Bestehende Links bleiben gueltig.

import fs from 'node:fs';
import path from 'node:path';
import { normalizeTags } from './write.mjs';
import { loadConfig, paths, parseFrontmatter, serializeFrontmatter, log } from './util.mjs';

function tageVersetzt(basis, tage) {
  const d = new Date(basis + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - tage);
  return d.toISOString().slice(0, 10);
}

export function migrate({ trocken = false } = {}) {
  const niche = loadConfig('niche.json');
  const site = loadConfig('site.json');
  const erlaubt = niche.themen || [];
  const proTag = Math.max(1, site.postsPerDay || 2);

  if (!erlaubt.length) {
    log('migration', 'Keine Themenliste in config/niche.json. Abbruch.');
    return;
  }

  const dateien = fs.readdirSync(paths.posts).filter((f) => f.endsWith('.md')).sort();
  if (!dateien.length) {
    log('migration', 'Keine Beitraege gefunden.');
    return;
  }

  // Neueste zuerst, damit der jüngste Artikel das aktuellste Datum bekommt.
  const geordnet = [...dateien].reverse();
  const heute = new Date().toISOString().slice(0, 10);

  let themenGeaendert = 0;
  let datenGeaendert = 0;
  const umbenennungen = [];

  geordnet.forEach((datei, i) => {
    const voll = path.join(paths.posts, datei);
    const { meta, body } = parseFrontmatter(fs.readFileSync(voll, 'utf8'));

    const alteThemen = Array.isArray(meta.tags) ? meta.tags : String(meta.tags || '').split(',');
    const neueThemen = normalizeTags(alteThemen, erlaubt);
    if (!neueThemen.length) neueThemen.push(erlaubt[0]);
    if (neueThemen.join('|') !== alteThemen.map((t) => String(t).trim()).join('|')) themenGeaendert++;

    const neuesDatum = tageVersetzt(heute, Math.floor(i / proTag));
    if (neuesDatum !== meta.date) datenGeaendert++;

    const neu = { ...meta, tags: neueThemen, date: neuesDatum };
    const neuerName = `${neuesDatum}-${meta.slug}.md`;

    if (trocken) {
      if (neuerName !== datei) umbenennungen.push(`${datei} -> ${neuerName}`);
      return;
    }

    fs.writeFileSync(voll, serializeFrontmatter(neu, body));
    if (neuerName !== datei) {
      fs.renameSync(voll, path.join(paths.posts, neuerName));
      umbenennungen.push(`${datei} -> ${neuerName}`);
    }
  });

  log('migration', `${dateien.length} Beitraege${trocken ? ' (Trockenlauf)' : ''}`);
  log('migration', `  Themen angepasst : ${themenGeaendert}`);
  log('migration', `  Daten verschoben : ${datenGeaendert}`);
  log('migration', `  Umbenannt        : ${umbenennungen.length}`);
  log('migration', `  Zeitraum         : ${tageVersetzt(heute, Math.floor((dateien.length - 1) / proTag))} bis ${heute}`);
}

if (process.argv[1] && process.argv[1].endsWith('migrate.mjs')) {
  migrate({ trocken: process.argv.includes('--trocken') });
}
