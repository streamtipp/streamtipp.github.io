// Lokale Steuerzentrale. Startet einen kleinen Server und oeffnet ihn in einem
// eigenen Fenster ohne Browserleiste, sodass es sich wie ein Programm anfuehlt.
//
// Bewusst kein Electron: das waere ein Download von rund 200 MB und ein Berg
// Abhaengigkeiten fuer ein Fenster, das Edge auf jedem Windows 11 ohnehin
// liefert. Der Server bindet nur an 127.0.0.1, von aussen ist nichts erreichbar.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, paths, loadConfig, readPosts, log } from '../util.mjs';
import { schaetzung, modellEinstellung } from '../llm.mjs';
import { loadPerformance } from '../performance.mjs';
import { loadWeights } from '../learn.mjs';
import { offeneAenderungen, veroeffentlichen } from '../veroeffentlichen.mjs';
import { pinterestUebersicht, pinterestExport, EXPORT_ORDNER, uhrzeitenFuer } from '../pinterest.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4180);
const EIGENE_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const EIGENE_URSPRUENGE = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

// Schutz vor fremden Webseiten. Der Server hoert zwar nur lokal, aber jede
// Seite, die im Browser offen ist, kann Anfragen an 127.0.0.1 schicken. Ohne
// diese Pruefung koennte eine fremde Seite Beitraege erzeugen, also Kontingent
// verbrauchen, oder sie veroeffentlichen.
//
//   Host-Kopf:   verhindert DNS-Rebinding, bei dem eine fremde Domain auf
//                127.0.0.1 zeigt.
//   Origin:      stammt die Anfrage aus einem anderen Ursprung, abweisen.
//   Eigener Kopf: Formulare und einfache Anfragen fremder Seiten koennen ihn
//                nicht setzen, ohne dass der Browser vorher nachfragt, und
//                diese Nachfrage beantwortet der Server nicht.
function vertrauenswuerdig(req, mitAktion) {
  if (!EIGENE_HOSTS.has(String(req.headers.host || ''))) return false;
  const origin = req.headers.origin;
  if (origin && !EIGENE_URSPRUENGE.has(origin)) return false;
  if (mitAktion && req.headers['x-streamtipp'] !== '1') return false;
  return true;
}

// Der Profil-Link landet als href in der App. Nur echte Pinterest-Adressen
// zulassen, sonst liesse sich dort ein javascript:- oder Phishing-Link ablegen.
function pinterestProfil(roh) {
  try {
    const u = new URL(String(roh || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (!/^([a-z]{2,3}\.)?pinterest\.(com|at|de|ch|co\.uk|fr|it|es|nl|pt|se|dk|ie)$/i.test(u.hostname) || u.username || u.password || u.port) return '';
    return `https://${u.hostname.toLowerCase()}${u.pathname}`.slice(0, 200);
  } catch {
    return '';
  }
}

function jsonAntwort(res, daten, code = 200) {
  const koerper = JSON.stringify(daten);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(koerper),
  });
  res.end(koerper);
}

function lade(datei, standard) {
  try {
    return JSON.parse(fs.readFileSync(path.join(paths.data, datei), 'utf8'));
  } catch {
    return standard;
  }
}

function geplanteAufgabe() {
  try {
    const roh = execFileSync('schtasks', ['/query', '/tn', 'contentbot', '/fo', 'list', '/v'], {
      encoding: 'latin1',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const feld = (namen) => {
      for (const zeile of roh.split(/\r?\n/)) {
        const i = zeile.indexOf(':');
        if (i === -1) continue;
        const k = zeile.slice(0, i).trim().toLowerCase();
        if (namen.some((n) => k.startsWith(n))) return zeile.slice(i + 1).trim();
      }
      return null;
    };
    // Die Aufgabenplanung traegt 30.11.1999 ein, solange eine Aufgabe noch nie
    // gelaufen ist. Das als Datum anzuzeigen waere nur verwirrend.
    const nieGelaufen = (wert) => (!wert || /1999/.test(wert) ? 'noch nie' : wert);

    return {
      eingerichtet: true,
      status: feld(['status', 'planungsstatus']),
      naechster: feld(['nächste laufzeit', 'naechste laufzeit', 'next run time']),
      letzter: nieGelaufen(feld(['letzte laufzeit', 'last run time'])),
    };
  } catch {
    return { eingerichtet: false };
  }
}

function offeneThemen(posts) {
  let plan;
  try {
    plan = loadConfig('themenplan.json');
  } catch {
    return null;
  }

  const slugs = new Set(posts.map((p) => p.slug));
  const state = lade('state.json', { usedTopics: [] });
  const benutzt = new Set(state.usedTopics || []);
  const frei = (t) => {
    const key = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return !benutzt.has(key) && !slugs.has(key);
  };

  const heute = new Date();
  const tag = `${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
  const imFenster = (e) => (e.ab <= e.bis ? tag >= e.ab && tag <= e.bis : tag >= e.ab || tag <= e.bis);

  const evergreen = plan.evergreen || [];
  const saisonal = plan.saisonal || [];

  return {
    evergreenGesamt: evergreen.length,
    evergreenOffen: evergreen.filter((e) => frei(e.titel)).length,
    saisonalGesamt: saisonal.length,
    saisonalAktiv: saisonal.filter(imFenster).map((e) => ({ titel: e.titel, anlass: e.anlass, bis: e.bis })),
    naechsteSaison: saisonal
      .filter((e) => !imFenster(e))
      .map((e) => ({ titel: e.titel, anlass: e.anlass, ab: e.ab }))
      .sort((a, b) => (a.ab >= tag ? 0 : 1) - (b.ab >= tag ? 0 : 1) || a.ab.localeCompare(b.ab))
      .slice(0, 3),
  };
}

// Zaehlt die Beitraege, die wirklich online sind, ueber den Suchindex der
// Live-Seite. Frueher standen hier die Adressen der Sitemap, und die enthalten
// auch Startseite, Suche und Kategorieseiten. 67 Adressen bei 61 Beitraegen
// sah dann wie ein Fehler aus.
async function liveStatus(site) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`${site.baseUrl}/suche-index.json?cb=${Date.now()}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { erreichbar: false, status: r.status };
    const index = await r.json();
    return { erreichbar: true, status: r.status, beitraege: Array.isArray(index) ? index.length : null };
  } catch (err) {
    return { erreichbar: false, fehler: err.message };
  }
}

async function status() {
  const site = loadConfig('site.json');
  const niche = loadConfig('niche.json');
  const posts = readPosts();
  const defs = (niche.formats || []).map((f) => ({ id: f.id, label: f.label || f.id }));
  const historie = lade('verbrauch.json', []);
  const perf = loadPerformance();
  const gewichte = loadWeights();

  const woerter = posts.map((p) => p.body.split(/\s+/).length);
  const heuteISO = new Date().toISOString().slice(0, 10);

  return {
    site: {
      titel: site.title,
      adresse: site.baseUrl,
      proTag: site.postsPerDay,
      autopush: Boolean(site.autopush),
      ...modellEinstellung(),
      affiliateAktiv: (() => { try { return loadConfig('affiliate.json').amazon.enabled; } catch { return false; } })(),
    },
    artikel: {
      gesamt: posts.length,
      nachKategorie: defs.map((d) => ({ ...d, anzahl: posts.filter((p) => p.meta.format === d.id).length })),
      woerterGesamt: woerter.reduce((a, b) => a + b, 0),
      woerterSchnitt: woerter.length ? Math.round(woerter.reduce((a, b) => a + b, 0) / woerter.length) : 0,
      neueste: posts.slice(0, 5).map((p) => ({ titel: p.meta.title, datum: p.meta.date, slug: p.slug })),
      heute: posts.filter((p) => p.meta.date === heuteISO).length,
    },
    plan: offeneThemen(posts),
    verbrauch: {
      laeufe: historie.length,
      gesamtKosten: historie.reduce((s, e) => s + (e.kostenGegenwert || 0), 0),
      gesamtTokens: historie.reduce((s, e) => s + (e.outputTokens || 0), 0),
      artikelGesamt: historie.reduce((s, e) => s + (e.artikel || 0), 0),
      heute: historie.filter((e) => e.zeit.slice(0, 10) === heuteISO)
        .reduce((s, e) => s + (e.kostenGegenwert || 0), 0),
      letzte: historie.slice(-8).reverse(),
      schaetzungProArtikel: schaetzung(historie, 1),
    },
    messung: perf
      ? {
          vorhanden: true,
          stand: perf.updatedAt,
          artikelMitDaten: perf.measured,
          klicks: perf.totalClicks,
          impressionen: perf.totalImpressions,
          top: perf.entries.filter((e) => e.measured).sort((a, b) => b.clicks - a.clicks).slice(0, 5)
            .map((e) => ({ slug: e.slug, klicks: e.clicks, impressionen: e.impressions, position: e.position })),
        }
      : { vorhanden: false },
    gewichte,
    aufgabe: geplanteAufgabe(),
    live: await liveStatus(site),
    veroeffentlichung: offeneAenderungen(),
    pinterest: (() => {
      try {
        const cfg = loadConfig('pinterest.json');
        const n = Math.max(1, Math.min(10, Number(cfg.pinsProTag) || 3));
        return { ...pinterestUebersicht(), pinsProTag: n, uhrzeiten: uhrzeitenFuer(n, cfg.uhrzeiten), profil: pinterestProfil(cfg.profil) };
      } catch (err) { return { fehler: err.message }; }
    })(),
    laeuftGerade,
  };
}

// Laengere Vorgaenge laufen als Ereignisstrom, damit die App den Fortschritt
// Zeile fuer Zeile zeigt statt minutenlang stillzustehen. Es laeuft immer nur
// einer: Erzeugen und Veroeffentlichen gleichzeitig wuerde einen halb fertigen
// Stand hochladen.

let laeuftGerade = null;

function strom(res, name, arbeit) {
  if (laeuftGerade) {
    return jsonAntwort(res, { fehler: `Es läuft bereits: ${laeuftGerade}. Bitte warten, bis das fertig ist.` }, 409);
  }
  laeuftGerade = name;

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const sende = (typ, daten) => {
    try {
      res.write(`event: ${typ}\ndata: ${JSON.stringify(daten)}\n\n`);
    } catch { /* Fenster wurde geschlossen, der Vorgang laeuft trotzdem zu Ende */ }
  };

  Promise.resolve()
    .then(() => arbeit(sende))
    .then((code) => sende('fertig', { code: code ?? 0 }))
    .catch((err) => {
      sende('zeile', { text: `Fehler: ${err.message}` });
      sende('fertig', { code: 1 });
    })
    .finally(() => {
      laeuftGerade = null;
      res.end();
    });
}

function erzeugen(sende, anzahl) {
  return new Promise((resolve) => {
    const kind = spawn(process.execPath, [path.join(ROOT, 'src', 'pipeline.mjs'), '--count', String(anzahl)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let rest = '';
    const verteile = (stueck) => {
      rest += stueck;
      const teile = rest.split('\n');
      rest = teile.pop();
      for (const z of teile) if (z.trim()) sende('zeile', { text: z.trimEnd() });
    };

    kind.stdout.on('data', (d) => verteile(String(d)));
    kind.stderr.on('data', (d) => verteile(String(d)));
    kind.on('close', (code) => {
      if (rest.trim()) sende('zeile', { text: rest.trimEnd() });
      resolve(code ?? 1);
    });
    kind.on('error', (err) => {
      sende('zeile', { text: `Fehler: ${err.message}` });
      resolve(1);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const aktionen = ['/api/erzeugen', '/api/veroeffentlichen', '/api/pinterest', '/api/pinterest-ordner', '/api/einstellungen'];
  const istAktion = aktionen.includes(url.pathname);

  if (!vertrauenswuerdig(req, istAktion)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Verboten');
  }
  if (istAktion && req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' });
    return res.end('Nur POST');
  }

  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs.readFileSync(path.join(HIER, 'ui.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }

    if (url.pathname === '/api/status') return jsonAntwort(res, await status());

    if (url.pathname === '/api/schaetzung') {
      const anzahl = Math.max(1, Math.min(50, Number(url.searchParams.get('anzahl')) || 1));
      return jsonAntwort(res, { anzahl, ...schaetzung(lade('verbrauch.json', []), anzahl) });
    }

    if (url.pathname === '/api/erzeugen') {
      const anzahl = Math.max(1, Math.min(50, Number(url.searchParams.get('anzahl')) || 1));
      return strom(res, `Erzeugung von ${anzahl} Beitrag${anzahl === 1 ? '' : 'en'}`, (sende) => erzeugen(sende, anzahl));
    }

    // Einstellungen aus der App. Nur zwei Zahlen, jeweils mit fester Ober- und
    // Untergrenze, damit ein Tippfehler nicht 500 Artikel am Tag ausloest.
    if (url.pathname === '/api/einstellungen') {
      let eingabe = {};
      try {
        eingabe = JSON.parse(await new Promise((resolve, reject) => {
          let text = '';
          req.on('data', (d) => { text += d; if (text.length > 2000) reject(new Error('zu gross')); });
          req.on('end', () => resolve(text || '{}'));
          req.on('error', reject);
        }));
      } catch {
        return jsonAntwort(res, { fehler: 'Ungültige Eingabe' }, 400);
      }

      const geaendert = {};
      if (eingabe.beitraegeProTag !== undefined) {
        const n = Number(eingabe.beitraegeProTag);
        if (!Number.isInteger(n) || n < 0 || n > 20) return jsonAntwort(res, { fehler: 'Beiträge pro Tag: ganze Zahl von 0 bis 20' }, 400);
        const datei = path.join(ROOT, 'config', 'site.json');
        const site = JSON.parse(fs.readFileSync(datei, 'utf8').replace(/^﻿/, ''));
        site.postsPerDay = n;
        fs.writeFileSync(datei, JSON.stringify(site, null, 2) + '\n');
        geaendert.beitraegeProTag = n;
      }
      if (eingabe.pinsProTag !== undefined) {
        const n = Number(eingabe.pinsProTag);
        if (!Number.isInteger(n) || n < 1 || n > 10) return jsonAntwort(res, { fehler: 'Pins pro Tag: ganze Zahl von 1 bis 10' }, 400);
        const datei = path.join(ROOT, 'config', 'pinterest.json');
        const cfg = JSON.parse(fs.readFileSync(datei, 'utf8').replace(/^﻿/, ''));
        cfg.pinsProTag = n;
        fs.writeFileSync(datei, JSON.stringify(cfg, null, 2) + '\n');
        geaendert.pinsProTag = n;
      }
      if (eingabe.pinterestProfil !== undefined) {
        const roh = String(eingabe.pinterestProfil).trim();
        const profil = roh ? pinterestProfil(roh) : '';
        if (roh && !profil) return jsonAntwort(res, { fehler: 'Bitte einen Link zu pinterest.com einfügen, z. B. https://www.pinterest.com/deinname/' }, 400);
        const datei = path.join(ROOT, 'config', 'pinterest.json');
        const cfg = JSON.parse(fs.readFileSync(datei, 'utf8').replace(/^﻿/, ''));
        if (profil) cfg.profil = profil; else delete cfg.profil;
        fs.writeFileSync(datei, JSON.stringify(cfg, null, 2) + '\n');
        geaendert.pinterestProfil = profil;
      }
      return jsonAntwort(res, { ok: true, geaendert });
    }

    if (url.pathname === '/api/pinterest') {
      return jsonAntwort(res, await pinterestExport({ trocken: url.searchParams.get('probe') === '1' }));
    }

    if (url.pathname === '/api/pinterest-ordner') {
      fs.mkdirSync(EXPORT_ORDNER, { recursive: true });
      spawn('explorer.exe', [EXPORT_ORDNER], { detached: true, stdio: 'ignore' }).unref();
      return jsonAntwort(res, { ok: true });
    }

    // Download der fertigen CSV. Nur Dateinamen nach festem Muster, damit sich
    // darueber keine anderen Dateien vom Rechner abrufen lassen.
    if (url.pathname === '/api/pinterest-datei') {
      const name = String(url.searchParams.get('name') || '');
      const datei = path.join(EXPORT_ORDNER, name);
      if (!/^pins-[\d-]+\.csv$/.test(name) || !fs.existsSync(datei)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('Datei nicht gefunden');
      }
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      });
      return res.end(fs.readFileSync(datei));
    }

    if (url.pathname === '/api/veroeffentlichen') {
      const probe = url.searchParams.get('probe') === '1';
      return strom(res, probe ? 'Prüfung' : 'Veröffentlichung', async (sende) => {
        const ergebnis = await veroeffentlichen({ sende, probe });
        return ergebnis.ok ? 0 : 1;
      });
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  } catch (err) {
    jsonAntwort(res, { fehler: err.message }, 500);
  }
});

// Edge im App-Modus: eigenes Fenster, keine Adressleiste, keine Tabs.
function fensterOeffnen(adresse) {
  if (process.argv.includes('--kein-fenster')) return;

  const edge = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p));

  if (edge) {
    spawn(edge, [`--app=${adresse}`, '--window-size=1180,900'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd', ['/c', 'start', '', adresse], { detached: true, stdio: 'ignore' }).unref();
  }
}

// Der belegte Port ist der haeufigste Fall: Die App laeuft schon, weil sie
// vorhin gestartet wurde. Frueher endete der zweite Start hier stillschweigend,
// ohne Fenster. Aus Sicht des Benutzers passierte beim Doppelklick nichts.
// Jetzt wird geprueft, ob dort die eigene App antwortet, und falls ja einfach
// das Fenster dafuer geoeffnet.
server.on('error', async (err) => {
  const adresse = `http://127.0.0.1:${PORT}`;

  if (err.code === 'EADDRINUSE') {
    let eigene = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`${adresse}/api/status`, { signal: ctrl.signal });
      clearTimeout(t);
      eigene = r.ok && Boolean((await r.json()).site);
    } catch { /* dort antwortet etwas anderes oder nichts */ }

    if (eigene) {
      log('app', `laeuft bereits auf ${adresse}, oeffne das Fenster`);
      fensterOeffnen(adresse);
      process.exitCode = 0;
      return;
    }

    process.stderr.write(
      `Port ${PORT} ist von einem anderen Programm belegt. Mit anderem Port starten: PORT=4181 npm run app\n`
    );
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`App konnte nicht starten: ${err.message}\n`);
  process.exitCode = 1;
});

// Nur lokal lauschen. Die App steuert die Erzeugung von Inhalten an, das
// gehoert nicht ins Netzwerk.
server.listen(PORT, '127.0.0.1', () => {
  const adresse = `http://127.0.0.1:${PORT}`;
  log('app', `laeuft auf ${adresse}`);
  fensterOeffnen(adresse);
});
