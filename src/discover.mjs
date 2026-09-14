// Themenfindung. Zieht Titel aus oeffentlichen RSS-Feeds, mischt sie mit den
// Seed-Themen aus der Nische und filtert alles heraus, worueber schon
// geschrieben wurde.
//
// Feed-Inhalte sind Fremddaten. Sie werden hier nur als Stichwort behandelt,
// gekuerzt und spaeter im Prompt klar als Daten markiert - nie als Anweisung.

import { loadConfig, loadState, log, slugify } from './util.mjs';
import { effectiveFormats, effectiveSources } from './learn.mjs';

const FETCH_TIMEOUT_MS = 8000;
const MAX_TITLE_LEN = 120;

async function fetchFeed(source) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'contentbot/1.0 (+RSS reader)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const NAMED = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  bdquo: '"', ldquo: '"', rdquo: '"', laquo: '<<', raquo: '>>',
  sbquo: ',', lsquo: "'", rsquo: "'", ndash: '-', mdash: '-', hellip: '...',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
};

// Feeds mischen benannte und numerische Entities, teils doppelt kodiert.
// Zwei Durchlaeufe reichen fuer alles, was in der Praxis vorkommt.
function decodeEntities(s) {
  const once = (t) =>
    t
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&([a-z]+);/gi, (m, name) => NAMED[name] ?? m);
  return once(once(s));
}

function extractTitles(xml) {
  const titles = [];
  const itemRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  const titleRe = /<title[^>]*>([\s\S]*?)<\/title>/i;

  for (const match of xml.match(itemRe) || []) {
    const t = match.match(titleRe);
    if (!t) continue;
    const clean = decodeEntities(
      t[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length > 3) titles.push(clean.slice(0, MAX_TITLE_LEN));
  }
  return titles;
}

function pickFormat(formats) {
  const pool = formats.flatMap((f) => Array(f.weight || 1).fill(f));
  return pool[Math.floor(Math.random() * pool.length)];
}

// Themen aus dem eigenen Plan. Sie haben Vorrang, weil sie dauerhaft gesucht
// werden, waehrend eine Tagesmeldung nach zwei Wochen niemanden mehr
// interessiert. Saisonales gewinnt gegen Zeitloses, solange sein Fenster offen
// ist: Wer am 24. Dezember ueber Weihnachtsfilme schreibt, ist ein Jahr zu
// spaet dran, denn Suchmaschinen brauchen Wochen.

function imFenster(eintrag, heute) {
  if (!eintrag.ab || !eintrag.bis) return true;
  const tag = `${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
  // Fenster ueber den Jahreswechsel hinweg, etwa 12-10 bis 01-06.
  return eintrag.ab <= eintrag.bis
    ? tag >= eintrag.ab && tag <= eintrag.bis
    : tag >= eintrag.ab || tag <= eintrag.bis;
}

function planThemen(formats) {
  let plan;
  try {
    plan = loadConfig('themenplan.json');
  } catch {
    return [];
  }

  const heute = new Date();
  const formOder = (id) => formats.find((f) => f.id === id) || formats[0];

  // Kaufberatungen bekommen eine eigene Schreibregel mit und kommen vor den
  // übrigen zeitlosen Themen dran: Nur sie führen Leser zu Produkten, und nur
  // darüber verdient die Seite etwas.
  const hinweis = (e) => (e.kaufberatung ? plan.kaufberatungHinweis : undefined);

  const saisonal = (plan.saisonal || [])
    .filter((e) => imFenster(e, heute))
    .map((e) => ({ hook: e.titel, origin: 'plan', anlass: e.anlass, hinweis: hinweis(e), format: formOder(e.form) }));

  const evergreen = (plan.evergreen || [])
    .map((e) => ({ hook: e.titel, origin: 'plan', hinweis: hinweis(e), format: formOder(e.form) }));

  return [...saisonal, ...shuffle(evergreen.filter((e) => e.hinweis)), ...shuffle(evergreen.filter((e) => !e.hinweis))];
}

export async function discover(count) {
  const niche = loadConfig('niche.json');
  const sources = effectiveSources();
  const formats = effectiveFormats();
  const state = loadState();
  const used = new Set(state.usedTopics || []);

  // Erst den Plan abarbeiten. Nur was danach noch fehlt, kommt aus den Feeds.
  const ausPlan = planThemen(formats);
  const chosenPlan = [];
  for (const cand of ausPlan) {
    const key = slugify(cand.hook);
    if (!key || used.has(key)) continue;
    used.add(key);
    chosenPlan.push({ ...cand, key });
    if (chosenPlan.length >= count) break;
  }

  if (chosenPlan.length) {
    const s = chosenPlan.filter((c) => c.anlass).length;
    log('discover', `${chosenPlan.length} aus dem Themenplan${s ? `, davon ${s} saisonal` : ''}`);
  }
  if (chosenPlan.length >= count) return chosenPlan;
  const restCount = count - chosenPlan.length;

  const fromFeeds = [];
  for (const source of sources) {
    try {
      // Feed-Titel sind fremder Text. Spitze Klammern raus, damit niemand mit
      // "</aufhaenger>" aus dem Datenblock im Prompt ausbrechen kann, und
      // Länge begrenzen, weil ein echter Titel nie 200 Zeichen braucht.
      const titles = extractTitles(await fetchFeed(source))
        .map((t) => String(t).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length <= 200);
      log('discover', `${source.name}: ${titles.length} Eintraege (Gewicht ${source.weight || 1})`);
      // Gewicht wirkt hier: Eintraege einer starken Quelle kommen mehrfach in
      // den Topf und werden dadurch haeufiger gezogen.
      for (let i = 0; i < (source.weight || 1); i++) {
        for (const t of titles) fromFeeds.push({ hook: t, origin: source.name });
      }
    } catch (err) {
      log('discover', `${source.name} nicht erreichbar (${err.message}) - wird uebersprungen`);
    }
  }

  const fromSeeds = niche.seedTopics.map((t) => ({ hook: t, origin: 'seed' }));

  // Feed-Themen zuerst, weil sie aktuell sind. Seeds sind das Sicherheitsnetz.
  const pool = [...shuffle(fromFeeds), ...shuffle(fromSeeds)];

  const chosen = [];
  for (const cand of pool) {
    const key = slugify(cand.hook);
    if (!key || used.has(key)) continue;
    used.add(key);
    chosen.push({ ...cand, key, format: pickFormat(formats) });
    if (chosen.length >= restCount) break;
  }

  const alle = [...chosenPlan, ...chosen];
  if (!alle.length) log('discover', 'Keine neuen Themen gefunden. Themenplan oder Seed-Liste erweitern.');
  return alle;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
