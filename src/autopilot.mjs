// Ein Durchlauf fuer die Aufgabenplanung. Alles, was taeglich passieren soll,
// in einem einzigen Aufruf, mit Protokoll und ohne Rueckfragen.
//
// Reihenfolge:
//   1. Messdaten einlesen und Gewichte neu berechnen (kein Modellaufruf)
//   2. Artikel schreiben und Seite bauen
//   3. einmal pro Woche den Rueckblick erzeugen
//   4. committen und pushen, wenn autopush aktiv ist
//
// Der Prozess bricht nie hart ab. Ein Fehler in einem Schritt wird protokolliert,
// die restlichen Schritte laufen weiter. Sonst haengt ein Ausfall tagelang
// unbemerkt fest.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, loadConfig, log } from './util.mjs';

const LOG_DIR = path.join(ROOT, 'logs');
const REVIEW_WEEKDAY = 1; // Montag

function writeLog(lines) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFileSync(file, lines.join('\n') + '\n');

  // Alte Protokolle aufraeumen, damit der Ordner nicht unbegrenzt waechst.
  const keep = 60;
  const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(LOG_DIR, old), { force: true });
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function step(name, fn, journal) {
  const started = Date.now();
  try {
    const result = await fn();
    journal.push(`[ok]   ${name} (${Math.round((Date.now() - started) / 1000)}s)`);
    return result;
  } catch (err) {
    journal.push(`[FEHL] ${name}: ${err.message}`);
    return null;
  }
}

async function main() {
  const started = new Date();
  const journal = [`=== Lauf ${started.toISOString()} ===`];
  const site = loadConfig('site.json');

  await step('Messdaten einlesen', async () => {
    const { refreshFromExports } = await import('./performance.mjs');
    refreshFromExports();
  }, journal);

  await step('Gewichte lernen', async () => {
    const { learn } = await import('./learn.mjs');
    learn();
  }, journal);

  const written = await step('Artikel schreiben', async () => {
    const { discover } = await import('./discover.mjs');
    const { writeArticle } = await import('./write.mjs');
    const { loadState, saveState } = await import('./util.mjs');

    const topics = await discover(site.postsPerDay || 2);
    const state = loadState();
    state.usedTopics ||= [];
    state.published ||= [];

    let n = 0;
    for (const topic of topics) {
      try {
        const post = await writeArticle(topic);
        state.usedTopics.push(topic.key);
        state.published.push({ slug: post.slug, date: post.meta.date, title: post.meta.title });
        journal.push(`       + ${post.slug}`);
        n++;
      } catch (err) {
        journal.push(`       ! "${topic.hook}": ${err.message}`);
      }
    }
    state.lastRun = new Date().toISOString();
    saveState(state);
    return n;
  }, journal);

  await step('Seite bauen', async () => {
    const { build } = await import('./build.mjs');
    build();
  }, journal);

  const ready = await step('Preflight', async () => {
    const { preflight } = await import('./preflight.mjs');
    const { problems } = preflight();
    for (const p of problems) journal.push(`       blockiert: ${p}`);
    return problems.length === 0;
  }, journal);

  if (started.getDay() === REVIEW_WEEKDAY) {
    await step('Wochenrueckblick', async () => {
      const { review } = await import('./review.mjs');
      await review();
    }, journal);
  }

  // --no-push erlaubt einen Probelauf, ohne dass etwas oeffentlich wird.
  const pushErlaubt = site.autopush && !process.argv.includes('--no-push');

  if (pushErlaubt && ready && written > 0) {
    await step('Veroeffentlichen', () => {
      git(['add', '-A']);
      const staged = git(['diff', '--cached', '--name-only']);
      if (!staged) {
        journal.push('       nichts zu committen');
        return;
      }
      git(['commit', '-m', `Automatischer Lauf ${started.toISOString().slice(0, 10)}: ${written} Beitraege`]);
      git(['push', 'origin', 'HEAD']);
    }, journal);
  } else {
    const grund = !site.autopush ? 'autopush ist aus'
      : !pushErlaubt ? 'Probelauf mit --no-push'
      : !ready ? 'Preflight blockiert'
      : 'keine neuen Beitraege';
    journal.push(`[halt] Nicht veroeffentlicht: ${grund}`);
  }

  const { verbrauchText } = await import('./llm.mjs');
  journal.push(`[verbr] ${verbrauchText()}`);
  journal.push(`=== Ende, Dauer ${Math.round((Date.now() - started.getTime()) / 1000)}s ===\n`);
  writeLog(journal);
  process.stdout.write(journal.join('\n') + '\n');
}

main().catch((err) => {
  writeLog([`=== Abbruch ${new Date().toISOString()} ===`, err.stack || err.message, '']);
  process.stderr.write(`Abbruch: ${err.message}\n`);
  process.exitCode = 1;
});
