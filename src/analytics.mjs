// Besucherzahlen aus Cloudflare Web Analytics für die App.
//
// Warum Cloudflare: kostenlos, ohne Cookies und ohne lokalen Speicher im
// Browser der Leser, deshalb braucht die Seite keinen Cookie-Banner. Die Seite
// lädt ein kleines Skript, das Seitenaufrufe zählt. Ausgewertet wird hier über
// die GraphQL-Schnittstelle von Cloudflare.
//
// Der API-Token liegt bewusst außerhalb des Projektordners, damit er nie in
// einen Commit geraten kann. Er braucht nur Leserechte: "Account Analytics"
// für die Zahlen und "Account Settings" für die Liste der Seiten.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadConfig, readPosts } from './util.mjs';

const API = 'https://api.cloudflare.com/client/v4';
const ORDNER = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Streamtipp');
const ZUGANG = path.join(ORDNER, 'cloudflare.json');
const HEX32 = /^[a-f0-9]{32}$/i;
const CACHE_MS = 5 * 60 * 1000;

let cache = null;

function zugangLaden() {
  try {
    const z = JSON.parse(fs.readFileSync(ZUGANG, 'utf8'));
    if (typeof z.token === 'string' && HEX32.test(z.accountId) && HEX32.test(z.siteTag)) return z;
  } catch { /* noch nicht verbunden */ }
  return null;
}

async function cf(pfad, token, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${API}${pfad}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    return { status: res.status, j: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
}

function fehlerText(j, status) {
  const e = (j.errors || [])[0];
  return e ? String(e.message || e.code).slice(0, 200) : `HTTP ${status}`;
}

// Cloudflare will Zeitangaben ohne Millisekunden.
const zeit = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// Verbindet die App mit Cloudflare: Konto und Seite suchen, Zugang lokal
// speichern und den öffentlichen Site-Token in config/site.json eintragen,
// damit der nächste Build den Zähler einbaut.
export async function verbinden(token) {
  token = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) {
    return { fehler: 'Das sieht nicht nach einem Cloudflare-API-Token aus. Er besteht aus rund 40 Buchstaben und Ziffern.' };
  }

  const konten = await cf('/accounts?per_page=50', token);
  if (!konten.j.success) return { fehler: `Cloudflare lehnt den Token ab: ${fehlerText(konten.j, konten.status)}` };
  if (!konten.j.result?.length) return { fehler: 'Der Token hat Zugriff auf kein Konto. Bei den Berechtigungen "Account" statt "Zone" wählen.' };

  const host = new URL(loadConfig('site.json').baseUrl).host;
  const kandidaten = [];
  let ohneRecht = 0;
  for (const konto of konten.j.result) {
    if (!HEX32.test(konto.id)) continue;
    const liste = await cf(`/accounts/${konto.id}/rum/site_info/list?per_page=50`, token);
    if (!liste.j.success) { ohneRecht++; continue; }
    for (const s of liste.j.result || []) {
      if (HEX32.test(s.site_tag) && HEX32.test(s.site_token)) {
        kandidaten.push({ accountId: konto.id, siteTag: s.site_tag, siteToken: s.site_token, passt: JSON.stringify(s).includes(host) });
      }
    }
  }

  if (!kandidaten.length) {
    return {
      fehler: ohneRecht
        ? 'Dem Token fehlt die Berechtigung "Account Settings: Read". Token bei Cloudflare bearbeiten und diese Leseberechtigung ergänzen.'
        : `Im Cloudflare-Konto gibt es noch keine Seite in Web Analytics. Dort "Add a site" wählen und ${host} eintragen.`,
    };
  }
  const passend = kandidaten.filter((k) => k.passt);
  const wahl = passend.length === 1 ? passend[0] : kandidaten.length === 1 ? kandidaten[0] : null;
  if (!wahl) return { fehler: `Im Konto gibt es mehrere Seiten, keine davon eindeutig für ${host}.` };

  // Probeabfrage, damit ein fehlendes Leserecht sofort auffällt und nicht
  // erst später als leere Karte.
  const probe = await abfrage({ token, ...wahl }, 1);
  if (probe.fehler) {
    return { fehler: `Die Seite wurde gefunden, aber die Zahlen lassen sich nicht lesen. Fehlt die Berechtigung "Account Analytics: Read"? (${probe.fehler})` };
  }

  fs.mkdirSync(ORDNER, { recursive: true });
  fs.writeFileSync(ZUGANG, JSON.stringify({ token, accountId: wahl.accountId, siteTag: wahl.siteTag, seit: new Date().toISOString() }, null, 2), { mode: 0o600 });

  const datei = path.join(ROOT, 'config', 'site.json');
  const site = JSON.parse(fs.readFileSync(datei, 'utf8').replace(/^﻿/, ''));
  const neu = site.analytics?.cloudflare !== wahl.siteToken;
  if (neu) {
    site.analytics = { ...(site.analytics || {}), cloudflare: wahl.siteToken };
    fs.writeFileSync(datei, JSON.stringify(site, null, 2) + '\n');
  }

  cache = null;
  return { ok: true, zaehlerNeu: neu };
}

// Nur die App vergisst den Zugang. Der Zähler auf der Seite bleibt, bis
// "analytics" aus config/site.json entfernt und neu veröffentlicht wird.
export function trennen() {
  try { fs.rmSync(ZUGANG, { force: true }); } catch { /* egal */ }
  cache = null;
  return { ok: true };
}

async function abfrage(z, tage) {
  const bis = new Date();
  const von = new Date(bis.getTime() - (tage - 1) * 86400000);
  von.setUTCHours(0, 0, 0, 0);
  const filter = `{ datetime_geq: "${zeit(von)}", datetime_leq: "${zeit(bis)}", siteTag: "${z.siteTag}" }`;
  const gruppe = (name, limit, sortierung, dimension, mitBesuchen = true) =>
    `${name}: rumPageloadEventsAdaptiveGroups(limit: ${limit}, filter: ${filter}, orderBy: [${sortierung}]) { count ${mitBesuchen ? 'sum { visits }' : ''} dimensions { ${dimension} } }`;

  // Alle Werte sind vorher geprüft (Hex-Kennungen, ISO-Zeiten), deshalb
  // dürfen sie direkt in der Abfrage stehen.
  const query = `query { viewer { accounts(filter: { accountTag: "${z.accountId}" }) {
    ${gruppe('tage', 40, 'date_ASC', 'date')}
    ${gruppe('seiten', 12, 'count_DESC', 'requestPath', false)}
    ${gruppe('quellen', 50, 'count_DESC', 'refererHost')}
    ${gruppe('laender', 8, 'count_DESC', 'countryName')}
    ${gruppe('geraete', 5, 'count_DESC', 'deviceType')}
  } } }`;

  const { status, j } = await cf('/graphql', z.token, { query });
  if (j.errors?.length || !j.data) return { fehler: fehlerText(j, status) };
  const konto = j.data.viewer?.accounts?.[0];
  if (!konto) return { fehler: 'Konto nicht gefunden' };
  return { konto, von, bis, tage };
}

const LAENDER = new Intl.DisplayNames(['de'], { type: 'region' });
const GERAETE = { desktop: 'Computer', mobile: 'Handy', tablet: 'Tablet' };

function quelleName(roh, eigenerHost) {
  const h = String(roh || '').toLowerCase().replace(/^www\./, '');
  if (!h) return 'Direkt oder unbekannt';
  if (h === eigenerHost) return null;
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return 'Google';
  if (/(^|\.)bing\.com$/.test(h)) return 'Bing';
  if (/(^|\.)pinterest\.[a-z.]+$/.test(h) || h === 'pin.it') return 'Pinterest';
  if (/(^|\.)(chatgpt\.com|openai\.com)$/.test(h)) return 'ChatGPT';
  if (/(^|\.)perplexity\.ai$/.test(h)) return 'Perplexity';
  if (/(^|\.)claude\.ai$/.test(h)) return 'Claude';
  if (/(^|\.)duckduckgo\.com$/.test(h)) return 'DuckDuckGo';
  if (/(^|\.)ecosia\.org$/.test(h)) return 'Ecosia';
  if (/(^|\.)yahoo\.com$/.test(h)) return 'Yahoo';
  return h.slice(0, 40);
}

function seitenTitel() {
  const titel = new Map([['', 'Startseite'], ['suche', 'Suche'], ['impressum.html', 'Impressum'], ['datenschutz.html', 'Datenschutz']]);
  for (const p of readPosts()) titel.set(p.meta.slug || p.slug, p.meta.title);
  try {
    for (const t of loadConfig('themenseiten.json').seiten || []) if (t.slug && t.titel) titel.set(`thema/${t.slug}`, t.titel);
  } catch { /* keine Themenseiten */ }
  return titel;
}

// Ist der Zähler schon auf der Live-Seite? Sonst zeigt die App den Hinweis,
// dass noch veröffentlicht werden muss.
async function zaehlerOnline(site) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const html = await (await fetch(`${site.baseUrl}/?cb=${Date.now()}`, { signal: ctrl.signal })).text();
    clearTimeout(timer);
    return html.includes('static.cloudflareinsights.com/beacon.min.js');
  } catch {
    return null;
  }
}

export async function besucher({ neu = false } = {}) {
  if (!neu && cache && Date.now() - cache.zeit < CACHE_MS) return cache.daten;

  const site = loadConfig('site.json');
  const z = zugangLaden();
  const grund = { verbunden: Boolean(z), zaehlerEingetragen: HEX32.test(String(site.analytics?.cloudflare || '')), zaehlerOnline: await zaehlerOnline(site) };
  if (!z) return grund;

  // 30 Tage, falls das Konto das erlaubt, sonst 7.
  let r = await abfrage(z, 30);
  if (r.fehler) r = await abfrage(z, 7);
  if (r.fehler) return { ...grund, fehler: r.fehler };

  const { konto } = r;
  const eigenerHost = new URL(site.baseUrl).host;

  const proTag = new Map((konto.tage || []).map((g) => [g.dimensions.date, { aufrufe: g.count || 0, besuche: g.sum?.visits || 0 }]));
  const tage = [];
  for (let d = new Date(r.von); d <= r.bis; d = new Date(d.getTime() + 86400000)) {
    const datum = d.toISOString().slice(0, 10);
    tage.push({ datum, ...(proTag.get(datum) || { aufrufe: 0, besuche: 0 }) });
  }
  const summe = (liste) => liste.reduce((s, t) => ({ aufrufe: s.aufrufe + t.aufrufe, besuche: s.besuche + t.besuche }), { aufrufe: 0, besuche: 0 });

  const titel = seitenTitel();
  const seiten = (konto.seiten || []).map((g) => {
    const pfad = String(g.dimensions.requestPath || '/');
    const schluessel = pfad.replace(/^\/+|\/+$/g, '');
    return { pfad, titel: titel.get(schluessel) || pfad, aufrufe: g.count || 0 };
  });

  const quellen = new Map();
  for (const g of konto.quellen || []) {
    const name = quelleName(g.dimensions.refererHost, eigenerHost);
    const besucheQuelle = g.sum?.visits || 0;
    if (!name || !besucheQuelle) continue;
    quellen.set(name, (quellen.get(name) || 0) + besucheQuelle);
  }

  const land = (code) => { try { return LAENDER.of(code) || code; } catch { return code || 'unbekannt'; } };

  const daten = {
    ...grund,
    zeitraumTage: r.tage,
    stand: new Date().toISOString(),
    heute: tage[tage.length - 1],
    woche: summe(tage.slice(-7)),
    gesamt: summe(tage),
    tage,
    seiten,
    quellen: [...quellen].map(([name, besuche]) => ({ name, besuche })).sort((a, b) => b.besuche - a.besuche).slice(0, 8),
    laender: (konto.laender || []).map((g) => ({ name: land(g.dimensions.countryName), besuche: g.sum?.visits || 0 })).filter((l) => l.besuche),
    geraete: (konto.geraete || []).map((g) => ({ name: GERAETE[g.dimensions.deviceType] || g.dimensions.deviceType || 'unbekannt', besuche: g.sum?.visits || 0 })).filter((g) => g.besuche),
  };
  cache = { zeit: Date.now(), daten };
  return daten;
}
