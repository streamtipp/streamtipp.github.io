// Orchestrator. Ein Durchlauf: Themen finden, schreiben, bauen, Zustand sichern.
//
// Aufruf:
//   node src/pipeline.mjs            normaler Lauf
//   node src/pipeline.mjs --dry      nur Themen zeigen, nichts schreiben
//   node src/pipeline.mjs --count 3  Anzahl Artikel fuer diesen Lauf
//   node src/pipeline.mjs --build    nur neu bauen, kein Modellaufruf

import { discover } from './discover.mjs';
import { writeArticle } from './write.mjs';
import { build } from './build.mjs';
import { reportPreflight } from './preflight.mjs';
import { detectProvider, verbrauchText, verbrauchSichern } from './llm.mjs';
import { refreshFromExports } from './performance.mjs';
import { learn } from './learn.mjs';
import { loadConfig, loadState, saveState, log } from './util.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function main() {
  const site = loadConfig('site.json');
  const dry = Boolean(arg('dry', false));
  const buildOnly = Boolean(arg('build', false));
  const count = Number(arg('count', site.postsPerDay)) || 1;

  if (buildOnly) {
    await build();
    // Der Exit-Code ist entscheidend: In GitHub Actions ist er das Einzige,
    // woran der Workflow einen fehlgeschlagenen Preflight erkennt. Ohne ihn
    // wuerde eine Seite ohne gueltiges Impressum trotzdem veroeffentlicht.
    if (!reportPreflight()) process.exitCode = 1;
    return;
  }

  log('start', `Provider: ${detectProvider()}, Ziel: ${count} Artikel`);

  // Messen und lernen vor dem Schreiben, damit dieser Lauf schon die neuen
  // Gewichte nutzt. Beides kostet keinen Modellaufruf.
  refreshFromExports();
  learn();

  const topics = await discover(count);
  if (!topics.length) {
    log('start', 'Nichts zu tun.');
    return;
  }

  log('discover', `${topics.length} Themen ausgewaehlt:`);
  for (const t of topics) log('discover', `  - [${t.format.id}] ${t.hook}`);

  if (dry) {
    log('start', 'Trockenlauf, es wurde nichts geschrieben.');
    return;
  }

  const state = loadState();
  state.usedTopics ||= [];
  state.published ||= [];

  let written = 0;
  for (const topic of topics) {
    try {
      const post = await writeArticle(topic);
      state.usedTopics.push(topic.key);
      state.published.push({ slug: post.slug, date: post.meta.date, title: post.meta.title });
      written++;
    } catch (err) {
      // Ein misslungener Artikel darf den Lauf nicht abbrechen. Das Thema
      // bleibt unverbraucht und kann beim naechsten Mal erneut drankommen.
      log('write', `Fehlgeschlagen bei "${topic.hook}": ${err.message}`);
    }
  }

  state.lastRun = new Date().toISOString();
  saveState(state);

  await build();
  const ok = reportPreflight();

  await verbrauchSichern(written);
  log('verbrauch', verbrauchText());
  log('done', `${written} von ${topics.length} Artikeln geschrieben. Deploy ${ok ? 'freigegeben' : 'blockiert'}.`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`Abbruch: ${err.message}\n`);
  process.exitCode = 1;
});
