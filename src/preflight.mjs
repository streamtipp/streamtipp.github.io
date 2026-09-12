// Sicherheitsnetz vor dem Veroeffentlichen.
//
// In Deutschland braucht eine Website mit Monetarisierung ein Impressum
// (§ 5 DDG) und eine Datenschutzerklaerung (Art. 13 DSGVO). Affiliate-Links
// muessen als Werbung gekennzeichnet sein. Die Pipeline blockiert daher den
// Deploy, solange Platzhalter drinstehen.
//
// Das ist keine Rechtsberatung, sondern eine Erinnerung an die offensichtlichen
// Pflichten. Im Zweifel pruefen lassen.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, paths, readPosts } from './util.mjs';

const PLACEHOLDER = /PLATZHALTER/;

export function preflight({ strict = true } = {}) {
  const site = loadConfig('site.json');
  const affiliate = loadConfig('affiliate.json');
  const problems = [];
  const warnings = [];

  if (PLACEHOLDER.test(site.author)) problems.push('config/site.json: author ist noch ein Platzhalter');
  if (PLACEHOLDER.test(site.email)) problems.push('config/site.json: email ist noch ein Platzhalter');
  if (site.baseUrl.includes('BENUTZERNAME')) problems.push('config/site.json: baseUrl zeigt noch auf BENUTZERNAME');

  for (const file of ['impressum.html', 'datenschutz.html']) {
    const full = path.join(paths.site, 'legal', file);
    if (!fs.existsSync(full)) {
      problems.push(`site/legal/${file} fehlt`);
      continue;
    }
    if (PLACEHOLDER.test(fs.readFileSync(full, 'utf8'))) {
      problems.push(`site/legal/${file} enthaelt noch Platzhalter`);
    }
  }

  if (affiliate.amazon.enabled && PLACEHOLDER.test(affiliate.amazon.partnerTag)) {
    problems.push('config/affiliate.json: amazon.enabled ist true, aber partnerTag ist ein Platzhalter');
  }
  if (affiliate.amazon.enabled && !affiliate.disclosure) {
    problems.push('config/affiliate.json: Affiliate ist aktiv, aber es gibt keinen Werbehinweis');
  }

  const posts = readPosts();
  if (posts.length < 15 && affiliate.amazon.enabled) {
    warnings.push(`Erst ${posts.length} Beitraege. Amazon PartnerNet akzeptiert duenne Seiten meist nicht.`);
  }
  for (const p of posts) {
    if (!p.meta.description) warnings.push(`${p.file}: keine description, schlecht fuer Suchergebnisse`);
  }

  return { problems, warnings, posts: posts.length };
}

export function reportPreflight() {
  const { problems, warnings, posts } = preflight();

  for (const w of warnings) process.stdout.write(`[warn]  ${w}\n`);
  for (const p of problems) process.stdout.write(`[BLOCK] ${p}\n`);

  if (problems.length) {
    process.stdout.write(`\n${problems.length} Punkt(e) blockieren den Deploy. Siehe docs/PLAYBOOK.md.\n`);
    return false;
  }
  process.stdout.write(`[ok]    Preflight bestanden, ${posts} Beitraege bereit.\n`);
  return true;
}
