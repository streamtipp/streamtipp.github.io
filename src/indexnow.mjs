// IndexNow: meldet neue und geaenderte Adressen direkt an Bing und Yandex,
// statt zu warten, bis ein Crawler von selbst vorbeikommt.
//
// Warum das hier steht: KI-Assistenten haben keinen eigenen Suchindex.
// ChatGPT sucht ueber Bing. Wer dort nicht steht, existiert fuer ChatGPT
// nicht. IndexNow ist der einzige kostenlose Weg, das aktiv zu beschleunigen.
// Kein Konto noetig, die Schluesseldatei auf der Domain ist der Nachweis.
//
// Google nimmt an IndexNow nicht teil. Dafuer braucht es die Search Console.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, paths, loadConfig, log } from './util.mjs';
import { gitBinaer } from './veroeffentlichen.mjs';

const ENDPUNKT = 'https://api.indexnow.org/IndexNow';

function adressenAusSitemap() {
  const datei = path.join(paths.dist, 'sitemap.xml');
  if (!fs.existsSync(datei)) return [];
  const xml = fs.readFileSync(datei, 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

// Die lokale Sitemap enthaelt auch Beitraege, die noch nicht gelesen und nicht
// gepusht sind. Deren Adressen gehen Bing nichts an: Sie wuerden 404 liefern
// und verraten vorab, woran gerade gearbeitet wird.
function unveroeffentlichteSlugs() {
  try {
    const online = new Set(
      execFileSync(gitBinaer(), ['ls-tree', '-r', '--name-only', 'origin/main', '--', 'content/posts'], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
        .split(/\r?\n/).map((f) => f.split('/').pop()).filter(Boolean)
    );
    return new Set(
      fs.readdirSync(paths.posts)
        .filter((f) => f.endsWith('.md') && !online.has(f))
        .map((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''))
    );
  } catch {
    return new Set();
  }
}

export async function melden({ trocken = false } = {}) {
  const site = loadConfig('site.json');

  if (!site.indexNowKey) {
    log('indexnow', 'Kein indexNowKey in config/site.json. Uebersprungen.');
    return false;
  }

  const lokal = unveroeffentlichteSlugs();
  const urls = adressenAusSitemap().filter((u) => !lokal.has(new URL(u).pathname.replace(/^\/|\/$/g, '')));
  if (!urls.length) {
    log('indexnow', 'Keine Adressen in der Sitemap. Erst bauen.');
    return false;
  }

  const host = new URL(site.baseUrl).host;
  const nutzlast = {
    host,
    key: site.indexNowKey,
    keyLocation: `${site.baseUrl}/${site.indexNowKey}.txt`,
    urlList: urls.slice(0, 10000),
  };

  if (trocken) {
    log('indexnow', `Trockenlauf: ${urls.length} Adressen fuer ${host} bereit, ${lokal.size} lokale Beitraege zurueckgehalten.`);
    return true;
  }

  try {
    const res = await fetch(ENDPUNKT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(nutzlast),
    });

    // 200 heisst angenommen, 202 heisst angenommen aber Schluessel wird noch
    // geprueft. Beides ist Erfolg. 403 heisst, die Schluesseldatei ist noch
    // nicht erreichbar, meist weil der Deploy noch laeuft.
    if (res.status === 200 || res.status === 202) {
      log('indexnow', `${urls.length} Adressen an Bing gemeldet (HTTP ${res.status}).`);
      return true;
    }
    if (res.status === 403) {
      log('indexnow', 'Abgelehnt: Schluesseldatei nicht erreichbar. Nach dem naechsten Deploy erneut versuchen.');
      return false;
    }
    log('indexnow', `Unerwartete Antwort HTTP ${res.status}.`);
    return false;
  } catch (err) {
    log('indexnow', `Nicht erreichbar: ${err.message}`);
    return false;
  }
}

if (process.argv[1] && process.argv[1].endsWith('indexnow.mjs')) {
  melden({ trocken: process.argv.includes('--trocken') });
}
