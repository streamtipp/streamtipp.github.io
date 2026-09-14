// Pinterest-Paket: erzeugt eine CSV fuer den Massen-Upload von Pinterest.
//
// Pinterest nimmt bis zu 200 Pins pro Datei. Die Spaltennamen muessen exakt dem
// offiziellen Muster entsprechen: Title, Media URL, Pinterest board, Thumbnail,
// Description, Link, Publish date, Keywords. Pinnwaende, die es noch nicht gibt,
// legt Pinterest beim Upload selbst an. Liegt das Datum in der Zukunft, wird der
// Pin automatisch zu diesem Zeitpunkt veroeffentlicht.
//
// Die Bilder muessen oeffentlich erreichbar sein. Deshalb landen nur Beitraege
// in der Datei, deren Pinterest-Bild auf der Live-Seite wirklich antwortet.
// Es wird nichts in deinem Namen gepostet: Die Datei laedst du selbst hoch.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, paths, loadConfig, readPosts, log } from './util.mjs';
import { pinDatei } from './vorschau.mjs';

const STAND = path.join(paths.data, 'pinterest.json');
export const EXPORT_ORDNER = path.join(ROOT, 'pinterest');
const MAX_PRO_DATEI = 200;
const SPALTEN = ['Title', 'Media URL', 'Pinterest board', 'Thumbnail', 'Description', 'Link', 'Publish date', 'Keywords'];

function standLaden() {
  try {
    const s = JSON.parse(fs.readFileSync(STAND, 'utf8'));
    return { exportiert: s.exportiert || {}, letzterTermin: s.letzterTermin || null };
  } catch {
    return { exportiert: {}, letzterTermin: null };
  }
}

function kuerzen(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const schnitt = t.slice(0, max - 1);
  return `${schnitt.slice(0, Math.max(schnitt.lastIndexOf(' '), max - 20))}…`;
}

// Anfuehrungszeichen nur, wo sie noetig sind, so wie Excel exportiert. Die
// erste Fassung setzte sie um jedes Feld, und Pinterest lehnte die Datei mit
// "falsches Format" ab.
function csvFeld(wert) {
  const t = String(wert ?? '');
  return /[",\r\n]|^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function zweistellig(n) {
  return String(n).padStart(2, '0');
}

// Format wie im Pinterest-Muster "2023-12-17T08:00:00". Laut Hilfe liest
// Pinterest die Zeit als UTC. Die Uhrzeiten in der Konfiguration sind aber
// lokale Zeit, also hier umrechnen: 18:30 in Wien ist im Sommer 16:30 UTC.
function termin(tag, uhrzeit) {
  const [h, m] = String(uhrzeit).split(':').map(Number);
  const lokal = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), h || 0, m || 0, 0);
  return lokal.toISOString().slice(0, 19);
}

// Uhrzeiten fuer n Pins am Tag. Reichen die konfigurierten nicht, werden die
// Pins gleichmaessig zwischen 17:00 und 22:00 verteilt, wenn Leute abends
// nach etwas zum Schauen suchen.
export function uhrzeitenFuer(n, vorgabe = []) {
  if (Array.isArray(vorgabe) && vorgabe.length >= n) return vorgabe.slice(0, n);
  if (n === 1) return ['19:30'];
  const von = 17 * 60;
  const bis = 22 * 60;
  return Array.from({ length: n }, (_, i) => {
    const minute = Math.round((von + ((bis - von) * i) / (n - 1)) / 15) * 15;
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  });
}

async function online(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    return r.ok && String(r.headers.get('content-type') || '').startsWith('image/');
  } catch {
    return false;
  }
}

// Sammelseiten als Pins. Sie kommen im Export vor den Beitraegen, weil ein Pin,
// der auf eine ganze Sammlung zeigt, mehr Grund zum Klicken liefert.
function sammlungenAlsBeitraege() {
  try {
    return (loadConfig('themenseiten.json').seiten || []).map((t) => ({
      slug: `thema-${t.slug}`,
      pfad: `thema/${t.slug}/`,
      meta: { title: t.titel, description: t.untertitel, format: 'sammlung', tags: [t.kurztitel].filter(Boolean), source: 'plan' },
    }));
  } catch {
    return [];
  }
}

// Wie viele Beitraege koennten in die naechste Datei? Ohne Netzwerk, fuer die App.
export function pinterestUebersicht() {
  const stand = standLaden();
  const posts = [...sammlungenAlsBeitraege(), ...readPosts()];
  const mitBild = posts.filter((p) => fs.existsSync(pinDatei(p.slug)));
  const offen = mitBild.filter((p) => !stand.exportiert[p.slug]);
  let letzteDatei = null;
  try {
    letzteDatei = fs.readdirSync(EXPORT_ORDNER).filter((f) => f.endsWith('.csv')).sort().pop() || null;
  } catch { /* noch kein Export */ }
  return {
    offen: offen.length,
    exportiert: Object.keys(stand.exportiert).length,
    ohneBild: posts.length - mitBild.length,
    letzterTermin: stand.letzterTermin,
    letzteDatei,
    verifiziert: Boolean(loadConfig('site.json').verification?.pinterest),
  };
}

// heute: kleine Zusatzdatei fuer den laufenden Abend. Nimmt nur die heutigen
// Uhrzeiten, die noch mindestens 15 Minuten entfernt sind. Reichen die nicht
// fuer "max" Pins, bleibt das Datum leer, dann veroeffentlicht Pinterest den
// Pin direkt beim Upload. Termine in der Vergangenheit werden nie geschrieben.
// auswahl: optional eine Liste von Slugs in gewuenschter Reihenfolge, etwa um
// fuer einen Abend gezielt passende Beitraege zu nehmen statt der Rangfolge.
export async function pinterestExport({ trocken = false, heute: nurHeute = false, max = MAX_PRO_DATEI, auswahl = null } = {}) {
  const site = loadConfig('site.json');
  const niche = loadConfig('niche.json');
  const cfg = loadConfig('pinterest.json');
  const stand = standLaden();
  const posts = [...sammlungenAlsBeitraege(), ...readPosts()];

  // Suchbegriffe, nach denen auf Pinterest wirklich gesucht wird. Die
  // Kategorienamen der Seite wie "Listen" taugen dafuer nicht.
  const suchbegriff = {
    listicle: 'Filmtipps',
    vergleich: 'Streaming Vergleich',
    guide: 'Heimkino Tipps',
    'wo-streamen': 'Wo läuft was',
  };
  const label = (id) => suchbegriff[id] || (niche.formats || []).find((f) => f.id === id)?.label || 'Filmtipps';
  const kandidaten = posts.filter((p) => !stand.exportiert[p.slug] && fs.existsSync(pinDatei(p.slug)));

  // Nur was online ist. Parallel, aber nicht zu viele Anfragen auf einmal.
  const geprueft = [];
  for (let i = 0; i < kandidaten.length; i += 8) {
    const gruppe = kandidaten.slice(i, i + 8);
    const ergebnisse = await Promise.all(gruppe.map((p) => online(`${site.baseUrl}/pins/${p.slug}.jpg`)));
    gruppe.forEach((p, j) => geprueft.push({ p, online: ergebnisse[j] }));
  }
  const bereit = geprueft.filter((x) => x.online).map((x) => x.p);
  const nichtOnline = geprueft.length - bereit.length;

  // Listen zuerst, weil sie auf Pinterest am besten funktionieren. Danach die
  // zeitlosen Themen aus dem eigenen Plan, dann der Rest. Jeweils neueste zuerst.
  const rang = (p) => (p.meta.format === 'sammlung' ? -10 : 0) + (p.meta.format === 'listicle' ? 0 : 1) * 2 + (p.meta.source === 'plan' ? 0 : 1);
  bereit.sort((a, b) => rang(a) - rang(b) || String(b.meta.date).localeCompare(String(a.meta.date)));
  if (Array.isArray(auswahl) && auswahl.length) {
    const reihenfolge = new Map(auswahl.map((s, i) => [s, i]));
    const gewaehlt = bereit.filter((p) => reihenfolge.has(p.slug)).sort((a, b) => reihenfolge.get(a.slug) - reihenfolge.get(b.slug));
    bereit.length = 0;
    bereit.push(...gewaehlt);
  }

  // Termine: ab morgen oder nach dem letzten schon geplanten Pin, je nachdem
  // was spaeter ist, damit zwei Exporte sich nicht am selben Tag stapeln.
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  let start = new Date(heute);
  if (!nurHeute) start.setDate(start.getDate() + 1);
  if (stand.letzterTermin && !nurHeute) {
    const nachLetztem = new Date(String(stand.letzterTermin).endsWith('Z') ? stand.letzterTermin : `${stand.letzterTermin}Z`);
    nachLetztem.setHours(0, 0, 0, 0);
    nachLetztem.setDate(nachLetztem.getDate() + 1);
    if (nachLetztem > start) start = nachLetztem;
  }
  const grenze = new Date(heute);
  grenze.setDate(grenze.getDate() + (cfg.maxTageVoraus || 28));

  const proTag = Math.max(1, Math.min(10, Number(cfg.pinsProTag) || 3));
  const uhrzeiten = uhrzeitenFuer(proTag, cfg.uhrzeiten);

  const obergrenze = Math.min(MAX_PRO_DATEI, Math.max(1, Number(max) || MAX_PRO_DATEI));
  const fruehestens = Date.now() + 15 * 60 * 1000;
  const heutigeTermine = nurHeute
    ? uhrzeiten.map((u) => termin(heute, u)).filter((t) => new Date(`${t}Z`).getTime() >= fruehestens)
    : [];

  const zeilen = [];
  for (const p of bereit) {
    if (zeilen.length >= obergrenze) break;

    let pinTermin;
    if (nurHeute) {
      // Leeres Datum heisst bei Pinterest: sofort veroeffentlichen.
      pinTermin = heutigeTermine[zeilen.length] || '';
    } else {
      const tag = new Date(start);
      tag.setDate(tag.getDate() + Math.floor(zeilen.length / proTag));
      if (tag > grenze) break;
      pinTermin = termin(tag, uhrzeiten[zeilen.length % proTag]);
    }

    const tags = Array.isArray(p.meta.tags) ? p.meta.tags : [];
    zeilen.push({
      slug: p.slug,
      titel: kuerzen(p.meta.title, 100),
      bild: `${site.baseUrl}/pins/${p.slug}.jpg`,
      pinnwand: cfg.pinnwaende?.[p.meta.format] || 'Filmtipps',
      beschreibung: kuerzen(`${p.meta.description || ''} ${cfg.abschluss || ''}`, 500),
      link: `${site.baseUrl}/${p.pfad || `${p.slug}/`}`,
      termin: pinTermin,
      keywords: [...new Set([...tags, label(p.meta.format)])].join(', '),
    });
  }

  const ergebnis = {
    anzahl: zeilen.length,
    nichtOnline,
    zurueckgestellt: bereit.length - zeilen.length,
    erster: zeilen.map((z) => z.termin).filter(Boolean).sort()[0] || null,
    letzter: zeilen.map((z) => z.termin).filter(Boolean).sort().at(-1) || null,
    sofort: zeilen.filter((z) => !z.termin).length,
    pinnwaende: [...new Set(zeilen.map((z) => z.pinnwand))],
    beispiel: zeilen[0] || null,
    datei: null,
  };

  if (trocken || !zeilen.length) return ergebnis;

  const csv = [
    // Kopfzeile unverpackt, genau wie im Muster von Pinterest.
    SPALTEN.join(','),
    ...zeilen.map((z) => [z.titel, z.bild, z.pinnwand, '', z.beschreibung, z.link, z.termin, z.keywords].map(csvFeld).join(',')),
  ].join('\r\n') + '\r\n';

  fs.mkdirSync(EXPORT_ORDNER, { recursive: true });
  const jetzt = new Date();
  const name = `pins-${jetzt.getFullYear()}-${zweistellig(jetzt.getMonth() + 1)}-${zweistellig(jetzt.getDate())}-${zweistellig(jetzt.getHours())}${zweistellig(jetzt.getMinutes())}.csv`;
  const datei = path.join(EXPORT_ORDNER, name);
  // UTF-8 ohne BOM: Mit BOM hiesse die erste Spalte fuer Pinterest nicht mehr
  // exakt "Title", und der Upload wuerde sie nicht erkennen.
  fs.writeFileSync(datei, csv, 'utf8');

  for (const z of zeilen) stand.exportiert[z.slug] = { termin: z.termin || 'sofort', datei: name };
  // Der spaetere Termin gewinnt. Eine Zusatzdatei fuer heute darf den Plan der
  // grossen Datei nicht nach vorn ziehen, sonst stapeln sich spaeter zwei Exporte.
  if (ergebnis.letzter && (!stand.letzterTermin || ergebnis.letzter > stand.letzterTermin)) {
    stand.letzterTermin = ergebnis.letzter;
  }
  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(STAND, JSON.stringify(stand, null, 2) + '\n');

  log('pinterest', `${zeilen.length} Pins nach ${path.relative(ROOT, datei)}, geplant ${ergebnis.erster} bis ${ergebnis.letzter}`);
  return { ...ergebnis, datei, name };
}

if (process.argv[1] && process.argv[1].endsWith('pinterest.mjs')) {
  const trocken = process.argv.includes('--trocken');
  const heute = process.argv.includes('--heute');
  const maxArg = process.argv.indexOf('--max');
  const max = maxArg !== -1 ? Number(process.argv[maxArg + 1]) : undefined;
  pinterestExport({ trocken, heute, max }).then((e) => {
    if (e.name) log('pinterest', `Datei: pinterest/${e.name}${e.sofort ? `, ${e.sofort} sofort` : ''}`);
    log('pinterest', `${e.anzahl} Pins${trocken ? ' (Trockenlauf)' : ''}, ${e.nichtOnline} noch nicht online, ${e.zurueckgestellt} für den nächsten Export zurückgestellt`);
    if (e.beispiel) log('pinterest', `Beispiel: ${JSON.stringify(e.beispiel)}`);
  });
}
