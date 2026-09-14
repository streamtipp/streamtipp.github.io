// Affiliate-Links einsetzen. Laeuft auf dem Markdown, bevor gerendert wird.
//
// Absichtlich zurueckhaltend: pro Stichwort hoechstens ein Link, und nur im
// Fliesstext, nicht in Ueberschriften. Zu viele Links schaden der Lesbarkeit
// und dem Vertrauen, und Amazon mag es auch nicht.

import { loadConfig } from './util.mjs';

function amazonSearchUrl(cfg, query) {
  const u = new URL(`https://www.${cfg.amazon.domain}/s`);
  u.searchParams.set('k', query);
  u.searchParams.set('tag', cfg.amazon.partnerTag);
  return u.toString();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function injectAffiliates(markdown) {
  const cfg = loadConfig('affiliate.json');
  if (!cfg.amazon.enabled) return { body: markdown, linked: [] };

  const linked = [];
  const lines = markdown.split('\n');

  const maxLinks = Number.isInteger(cfg.maxLinks) ? cfg.maxLinks : 4;

  for (const slot of cfg.productSlots) {
    if (linked.length >= maxLinks) break;
    if (linked.includes(slot.keyword)) continue;
    // "Leinwand" meint in Filmtexten meist das Kino. Nur verlinken, wenn der
    // Beitrag auch wirklich von Beamern handelt.
    if (slot.nurMit && !new RegExp(escapeRe(slot.nurMit), 'i').test(markdown)) continue;

    // Wortgrenze von Hand, damit Umlaute nicht als Grenze zaehlen. Ein
    // Bindestrich davor oder danach zaehlt als Wortteil: "Blu-ray-Player" ist
    // kein Film, "Mini-Beamer" hat einen eigenen Link.
    const re = new RegExp(`(^|[^\\[\\wäöüß-])(${escapeRe(slot.keyword)})(?![\\wäöüß\\]-])`, 'i');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^#{1,6}\s/.test(line)) continue; // keine Links in Ueberschriften
      if (line.includes('](http')) continue; // Zeile hat schon einen Link
      if (!re.test(line)) continue;

      lines[i] = line.replace(re, (_m, pre, word) => `${pre}[${word}](${amazonSearchUrl(cfg, slot.query)})`);
      linked.push(slot.keyword);
      break;
    }
  }

  let body = lines.join('\n');
  if (linked.length) body = `> ${cfg.disclosure}\n\n${body}`;

  return { body, linked };
}
