// Vorschaubilder fuer geteilte Links (Open Graph) und die Favicon-Grafiken.
//
// Warum Edge: WhatsApp, Facebook, X und LinkedIn zeigen nur Pixelbilder, keine
// SVGs. Node kann ohne Zusatzbibliothek keine Schrift in Bilder zeichnen. Edge
// kann das und liegt auf jedem Windows 11. Die Artikel entstehen ohnehin auf
// diesem Rechner, deshalb werden die Bilder hier erzeugt und mit ins Repository
// gelegt. Der Build bei GitHub findet kein Edge, ueberspringt diesen Schritt
// und kopiert nur, was schon da ist.
//
// Warum JPEG ueber die Entwicklerschnittstelle statt "--screenshot": Das liefert
// nur PNG, und Farbverlaeufe machen PNG gross. Gemessen 353 KB fuer ein Bild,
// WhatsApp zeigt Vorschauen ueber etwa 300 KB oft gar nicht an. Nebeneffekt:
// Ein einziger Edge-Start reicht fuer alle Bilder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { paths, log } from './util.mjs';
import { ICONS, VARIANTEN, variante, glyphFor, FAVICON_SVG } from './design.mjs';

// Hochzaehlen, wenn sich die Gestaltung der Bilder aendert. Dann werden alle
// neu erzeugt, sonst nur neue oder geaenderte Beitraege.
const DESIGN_VERSION = 1;

export const OG_BREITE = 1200;
export const OG_HOEHE = 630;
export const OG_ORDNER = path.join(paths.site, 'og');
export const PIN_ORDNER = path.join(paths.site, 'pins');
export const PIN_BREITE = 1000;
export const PIN_HOEHE = 1500;
export const ICON_ORDNER = path.join(paths.site, 'icons');
const MANIFEST = path.join(OG_ORDNER, 'manifest.json');

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function edgePfad() {
  if (process.platform !== 'win32') return null;
  return [
    process.env.EDGE_BIN,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean).find((p) => fs.existsSync(p)) || null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function markeHtml(titel) {
  const m = String(titel).match(/^(.*?)(tipp)$/i);
  return m ? `${esc(m[1])}<span>${esc(m[2])}</span>` : esc(titel);
}

// Schriftgroesse nach Titellaenge, damit auch lange Titel in drei Zeilen passen.
function titelGroesse(titel) {
  const n = String(titel).length;
  if (n <= 28) return 92;
  if (n <= 42) return 80;
  if (n <= 58) return 70;
  if (n <= 74) return 62;
  return 54;
}

function ogHtml({ titel, kategorie, symbol, v, marke, domain }) {
  const [c1, c2] = VARIANTEN[v] || VARIANTEN[0];
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;width:${OG_BREITE}px;height:${OG_HOEHE}px;overflow:hidden}
body{position:relative;color:#f7ede1;font-family:"Segoe UI",system-ui,sans-serif;
  background:linear-gradient(140deg,${c1} 0%,${c2} 100%)}
.licht{position:absolute;inset:0;background:radial-gradient(900px 560px at 8% -18%,rgba(255,214,160,.34),transparent 62%)}
.boden{position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(8,4,8,.55))}
.inhalt{position:absolute;left:80px;top:72px;bottom:64px;width:820px;display:flex;flex-direction:column}
.kat{align-self:flex-start;display:flex;align-items:center;gap:14px;font:700 22px/1 "Segoe UI",sans-serif;
  letter-spacing:.16em;text-transform:uppercase;color:#f2b56b}
.kat::before{content:"";width:12px;height:12px;border-radius:50%;background:#f2b56b;box-shadow:0 0 18px #f2b56b}
h1{margin:auto 0;font:700 ${titelGroesse(titel)}px/1.04 "Bahnschrift SemiCondensed","Bahnschrift","Arial Narrow",sans-serif;
  letter-spacing:.004em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
  text-wrap:balance;text-shadow:0 2px 30px rgba(0,0,0,.35)}
.fuss{display:flex;align-items:baseline;gap:18px}
.marke{font:700 44px/1 "Bahnschrift SemiCondensed","Bahnschrift",sans-serif}
.marke span{color:#e8a95c}
.domain{font:400 24px/1 "Segoe UI",sans-serif;color:rgba(247,237,225,.62)}
.symbol{position:absolute;right:84px;top:50%;width:190px;height:190px;transform:translateY(-50%);color:#f7ede1;opacity:.9;
  filter:drop-shadow(0 6px 30px rgba(0,0,0,.35))}
.symbol svg{width:100%;height:100%}
.leiste{position:absolute;left:0;top:0;bottom:0;width:10px;background:linear-gradient(180deg,#e8a95c,rgba(232,169,92,.15))}
</style></head><body>
<div class="licht"></div><div class="boden"></div><div class="leiste"></div>
<div class="inhalt">
  <div class="kat">${esc(kategorie)}</div>
  <h1>${esc(titel)}</h1>
  <div class="fuss"><span class="marke">${markeHtml(marke)}</span><span class="domain">${esc(domain)}</span></div>
</div>
<div class="symbol">${ICONS[symbol] || ICONS.ticket}</div>
</body></html>`;
}

// Pinterest-Bild im Hochformat 2:3, dem Format, das Pinterest empfiehlt. Der
// Titel steht gross im Bild, weil Pins im Feed ohne Text darunter gesehen
// werden. Die Beschreibung als zweite Zeile gibt den Grund zum Klicken.
function pinHtml({ titel, kategorie, symbol, v, marke, domain, unterzeile }) {
  const [c1, c2] = VARIANTEN[v] || VARIANTEN[0];
  const n = String(titel).length;
  const groesse = n <= 30 ? 118 : n <= 45 ? 104 : n <= 60 ? 92 : n <= 75 ? 82 : 74;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;width:${PIN_BREITE}px;height:${PIN_HOEHE}px;overflow:hidden}
body{position:relative;color:#f7ede1;font-family:"Segoe UI",system-ui,sans-serif;
  background:linear-gradient(160deg,${c1} 0%,${c2} 78%)}
.licht{position:absolute;inset:0;background:radial-gradient(1100px 900px at 10% -8%,rgba(255,214,160,.36),transparent 60%)}
.boden{position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(8,4,8,.62))}
.kopf{position:absolute;left:90px;right:90px;top:96px;display:flex;align-items:center;justify-content:space-between}
.marke{font:700 58px/1 "Bahnschrift SemiCondensed","Bahnschrift",sans-serif}
.marke span{color:#e8a95c}
.symbol{width:120px;height:120px;color:#f7ede1;opacity:.9;filter:drop-shadow(0 6px 30px rgba(0,0,0,.35))}
.symbol svg{width:100%;height:100%}
.mitte{position:absolute;left:90px;right:90px;top:340px;bottom:250px;display:flex;flex-direction:column;justify-content:center}
.kat{align-self:flex-start;display:flex;align-items:center;gap:18px;margin-bottom:44px;font:700 30px/1 "Segoe UI",sans-serif;
  letter-spacing:.16em;text-transform:uppercase;color:#f2b56b}
.kat::before{content:"";width:16px;height:16px;border-radius:50%;background:#f2b56b;box-shadow:0 0 22px #f2b56b}
h1{margin:0;font:700 ${groesse}px/1.03 "Bahnschrift SemiCondensed","Bahnschrift","Arial Narrow",sans-serif;
  display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;text-wrap:balance;
  text-shadow:0 2px 34px rgba(0,0,0,.35)}
.unter{margin:44px 0 0;font:400 38px/1.4 "Segoe UI",sans-serif;color:rgba(247,237,225,.84);
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.fuss{position:absolute;left:90px;right:90px;bottom:96px;display:flex;align-items:center;justify-content:space-between;
  padding-top:40px;border-top:2px solid rgba(232,169,92,.45)}
.domain{font:600 36px/1 "Segoe UI",sans-serif;color:#f7ede1}
.pfeil{font:700 36px/1 "Segoe UI",sans-serif;color:#e8a95c;letter-spacing:.04em}
</style></head><body>
<div class="licht"></div><div class="boden"></div>
<div class="kopf"><span class="marke">${markeHtml(marke)}</span><div class="symbol">${ICONS[symbol] || ICONS.ticket}</div></div>
<div class="mitte">
  <div class="kat">${esc(kategorie)}</div>
  <h1>${esc(titel)}</h1>
  ${unterzeile ? `<p class="unter">${esc(unterzeile)}</p>` : ''}
</div>
<div class="fuss"><span class="domain">${esc(domain)}</span><span class="pfeil">Jetzt lesen →</span></div>
</body></html>`;
}

export function pinDatei(slug) {
  return path.join(PIN_ORDNER, `${slug}.jpg`);
}

function iconHtml(groesse, abgerundet) {
  const svg = abgerundet ? FAVICON_SVG : FAVICON_SVG.replace('rx="14"', 'rx="0"').replace('rx="14"', 'rx="0"');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${groesse}px;height:${groesse}px;overflow:hidden;background:transparent}
svg{display:block;width:${groesse}px;height:${groesse}px}
</style></head><body>${svg}</body></html>`;
}

// ---------------------------------------------------------------------------
// Kleiner Client fuer das Chrome DevTools Protocol, das Edge ebenfalls spricht.

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.naechsteId = 0;
    this.offen = new Map();
    this.lauscher = new Set();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8'));
      if (m.id && this.offen.has(m.id)) {
        const { resolve, reject, timer } = this.offen.get(m.id);
        clearTimeout(timer);
        this.offen.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else if (m.method) {
        for (const l of this.lauscher) l(m);
      }
    });
  }

  senden(method, params = {}, sessionId) {
    const id = ++this.naechsteId;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.offen.delete(id);
        reject(new Error(`Zeitüberschreitung bei ${method}`));
      }, 30000);
      this.offen.set(id, { resolve, reject, timer });
    });
  }

  ereignis(method, sessionId) {
    return new Promise((resolve) => {
      const l = (m) => {
        if (m.method === method && m.sessionId === sessionId) {
          this.lauscher.delete(l);
          resolve(m.params);
        }
      };
      this.lauscher.add(l);
    });
  }
}

async function edgeStarten(edge) {
  // Eigenes, leeres Profil: sonst kollidiert der unsichtbare Edge mit einem
  // offenen Fenster, etwa der Steuerungs-App.
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'streamtipp-vorschau-'));
  const kind = spawn(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--user-data-dir=${profil}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  const portDatei = path.join(profil, 'DevToolsActivePort');
  for (let i = 0; i < 150; i++) {
    if (fs.existsSync(portDatei)) {
      const [port, pfad] = fs.readFileSync(portDatei, 'utf8').split(/\r?\n/);
      if (port && pfad) {
        const ws = new WebSocket(`ws://127.0.0.1:${port.trim()}${pfad.trim()}`);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', () => reject(new Error('Verbindung zu Edge fehlgeschlagen')), { once: true });
        });
        return { kind, profil, ws };
      }
    }
    await warte(100);
  }
  kind.kill();
  throw new Error('Edge hat die Entwicklerschnittstelle nicht geöffnet.');
}

async function edgeBeenden({ kind, profil, ws }, cdp) {
  try { await cdp?.senden('Browser.close'); } catch { /* schon zu */ }
  try { ws.close(); } catch { /* egal */ }
  await warte(400);
  try { kind.kill(); } catch { /* schon beendet */ }
  // Das Profil ist manchmal noch kurz gesperrt. Liegen gelassene Reste raeumt
  // Windows im Temp-Ordner selbst auf, deshalb kein Fehler, wenn es nicht klappt.
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(profil, { recursive: true, force: true }); break; } catch { await warte(300); }
  }
}

async function zeichnen(cdp, sessionId, { html, breite, hoehe, format, qualitaet, transparent }) {
  await cdp.senden('Emulation.setDeviceMetricsOverride', { width: breite, height: hoehe, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.senden('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {}, sessionId);

  const geladen = cdp.ereignis('Page.loadEventFired', sessionId);
  await cdp.senden('Page.navigate', { url: `data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}` }, sessionId);
  await geladen;
  await cdp.senden('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true }, sessionId);

  const { data } = await cdp.senden('Page.captureScreenshot', {
    format,
    ...(format === 'jpeg' ? { quality: qualitaet } : {}),
    clip: { x: 0, y: 0, width: breite, height: hoehe, scale: 1 },
    captureBeyondViewport: false,
  }, sessionId);
  return Buffer.from(data, 'base64');
}

function pruefsumme(daten) {
  return crypto.createHash('sha1').update(JSON.stringify({ DESIGN_VERSION, ...daten })).digest('hex').slice(0, 16);
}

function manifestLaden() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}

export function ogDatei(slug) {
  return path.join(OG_ORDNER, `${slug}.jpg`);
}

// Erzeugt fehlende oder veraltete Bilder. Gibt die Anzahl erzeugter Bilder
// zurueck. Wirft nie: Ein fehlendes Vorschaubild darf keinen Build verhindern.
export async function vorschauenErzeugen({ site, posts, labelFor }) {
  const edge = edgePfad();
  if (!edge) {
    log('vorschau', 'Kein Edge gefunden, Vorschaubilder werden nur übernommen, nicht erzeugt.');
    return 0;
  }

  fs.mkdirSync(OG_ORDNER, { recursive: true });
  fs.mkdirSync(PIN_ORDNER, { recursive: true });
  fs.mkdirSync(ICON_ORDNER, { recursive: true });

  const domain = new URL(site.baseUrl).host;
  const manifest = manifestLaden();

  const auftraege = [];
  const benoetigt = new Set(['_start']);

  const start = { titel: site.tagline, kategorie: 'Film · Serie · Heimkino', symbol: 'ticket', v: 0, marke: site.title, domain };
  const startSumme = pruefsumme(start);
  if (manifest._start !== startSumme || !fs.existsSync(ogDatei('_start'))) {
    auftraege.push({ art: 'og', schluessel: '_start', summe: startSumme, daten: start });
  }

  for (const p of posts) {
    benoetigt.add(p.slug);
    const daten = {
      titel: p.meta.title,
      kategorie: p.cover?.label || labelFor(p.meta.format),
      symbol: p.cover?.symbol || glyphFor(p).w,
      v: Number.isInteger(p.cover?.v) ? p.cover.v : variante(p.slug),
      marke: site.title,
      domain,
    };
    const summe = pruefsumme(daten);
    if (manifest[p.slug] !== summe || !fs.existsSync(ogDatei(p.slug))) {
      auftraege.push({ art: 'og', schluessel: p.slug, summe, daten });
    }

    // Pins bekommen zusaetzlich die Beschreibung als Unterzeile.
    const pinDaten = { ...daten, unterzeile: p.meta.description || '', art: 'pin' };
    const pinSumme = pruefsumme(pinDaten);
    if (manifest[`pin:${p.slug}`] !== pinSumme || !fs.existsSync(pinDatei(p.slug))) {
      auftraege.push({ art: 'pin', schluessel: p.slug, summe: pinSumme, daten: pinDaten });
    }
  }

  const iconSumme = pruefsumme({ FAVICON_SVG });
  const iconsFehlen = manifest._icons !== iconSumme
    || !fs.existsSync(path.join(ICON_ORDNER, 'favicon-48.png'))
    || !fs.existsSync(path.join(ICON_ORDNER, 'apple-touch-icon.png'));

  // Bilder geloeschter Beitraege entfernen, damit der Ordner nicht mitwaechst.
  let entfernt = 0;
  for (const [ordner, praefix] of [[OG_ORDNER, ''], [PIN_ORDNER, 'pin:']]) {
    for (const f of fs.readdirSync(ordner)) {
      if (!f.endsWith('.jpg')) continue;
      const slug = f.slice(0, -4);
      if (!benoetigt.has(slug) || (praefix && slug === '_start')) {
        fs.rmSync(path.join(ordner, f), { force: true });
        delete manifest[praefix + slug];
        entfernt++;
      }
    }
  }

  if (!auftraege.length && !iconsFehlen) {
    if (entfernt) {
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
      log('vorschau', `${entfernt} verwaiste Vorschaubilder entfernt`);
    }
    return 0;
  }

  const anzahlOg = auftraege.filter((a) => a.art === 'og').length;
  const anzahlPin = auftraege.length - anzahlOg;
  log('vorschau', `erzeuge ${anzahlOg} Vorschaubilder und ${anzahlPin} Pinterest-Bilder${iconsFehlen ? ' sowie die Favicons' : ''} ...`);

  let edgeProzess;
  let cdp;
  let erzeugt = 0;
  try {
    edgeProzess = await edgeStarten(edge);
    cdp = new Cdp(edgeProzess.ws);
    const { targetId } = await cdp.senden('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.senden('Target.attachToTarget', { targetId, flatten: true });
    await cdp.senden('Page.enable', {}, sessionId);

    for (const a of auftraege) {
      try {
        const istPin = a.art === 'pin';
        const bild = await zeichnen(cdp, sessionId, istPin
          ? { html: pinHtml(a.daten), breite: PIN_BREITE, hoehe: PIN_HOEHE, format: 'jpeg', qualitaet: 86 }
          : { html: ogHtml(a.daten), breite: OG_BREITE, hoehe: OG_HOEHE, format: 'jpeg', qualitaet: 86 });
        fs.writeFileSync(istPin ? pinDatei(a.schluessel) : ogDatei(a.schluessel), bild);
        manifest[istPin ? `pin:${a.schluessel}` : a.schluessel] = a.summe;
        erzeugt++;
        // Zwischendurch speichern: Bricht der Lauf ab, muss beim naechsten Mal
        // nicht alles von vorn gezeichnet werden.
        if (erzeugt % 10 === 0) fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
      } catch (err) {
        log('vorschau', `Bild für ${a.schluessel} fehlgeschlagen: ${err.message}`);
      }
    }

    if (iconsFehlen) {
      const fav = await zeichnen(cdp, sessionId, { html: iconHtml(48, true), breite: 48, hoehe: 48, format: 'png', transparent: true });
      fs.writeFileSync(path.join(ICON_ORDNER, 'favicon-48.png'), fav);
      // Apple rundet die Ecken selbst ab und fuellt Transparenz schwarz, deshalb
      // hier eckig und deckend.
      const apple = await zeichnen(cdp, sessionId, { html: iconHtml(180, false), breite: 180, hoehe: 180, format: 'png', transparent: false });
      fs.writeFileSync(path.join(ICON_ORDNER, 'apple-touch-icon.png'), apple);
      manifest._icons = iconSumme;
    }
  } catch (err) {
    log('vorschau', `Vorschaubilder übersprungen: ${err.message}`);
  } finally {
    if (edgeProzess) await edgeBeenden(edgeProzess, cdp);
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  }

  log('vorschau', `${erzeugt} Bild${erzeugt === 1 ? '' : 'er'} erzeugt${entfernt ? `, ${entfernt} verwaiste entfernt` : ''}`);
  return erzeugt;
}
