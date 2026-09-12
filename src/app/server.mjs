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
import { schaetzung } from '../llm.mjs';
import { loadPerformance } from '../performance.mjs';
import { loadWeights } from '../learn.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4180);

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

async function liveStatus(site) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`${site.baseUrl}/sitemap.xml?cb=${Date.now()}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { erreichbar: false, status: r.status };
    const xml = await r.text();
    return { erreichbar: true, status: r.status, adressen: (xml.match(/<loc>/g) || []).length };
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
  };
}

// Erzeugung als Ereignisstrom, damit die App den Fortschritt Zeile fuer Zeile
// zeigt statt minutenlang stillzustehen.

let laeuftGerade = false;

function erzeugen(res, anzahl) {
  if (laeuftGerade) {
    return jsonAntwort(res, { fehler: 'Es laeuft bereits ein Durchgang.' }, 409);
  }
  laeuftGerade = true;

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const sende = (typ, daten) => res.write(`event: ${typ}\ndata: ${JSON.stringify(daten)}\n\n`);
  sende('start', { anzahl });

  const kind = spawn(process.execPath, [path.join(ROOT, 'src', 'pipeline.mjs'), '--count', String(anzahl)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let rest = '';
  const verteile = (stueck) => {
    rest += stueck;
    const zeilen = rest.split('\n');
    rest = zeilen.pop();
    for (const z of zeilen) if (z.trim()) sende('zeile', { text: z.trimEnd() });
  };

  kind.stdout.on('data', (d) => verteile(String(d)));
  kind.stderr.on('data', (d) => verteile(String(d)));

  kind.on('close', (code) => {
    if (rest.trim()) sende('zeile', { text: rest.trimEnd() });
    sende('fertig', { code });
    laeuftGerade = false;
    res.end();
  });

  kind.on('error', (err) => {
    sende('zeile', { text: `Fehler: ${err.message}` });
    sende('fertig', { code: 1 });
    laeuftGerade = false;
    res.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

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
      return erzeugen(res, anzahl);
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
