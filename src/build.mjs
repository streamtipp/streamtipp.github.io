// Statischer Site-Generator. Liest content/posts/*.md und schreibt dist/.
//
// Erzeugt: Startseite, Beitragsseiten, Kategorieseiten nach Artikelform,
// eine Suchseite mit Index, Rechtstexte, Feed, Sitemap und robots.txt.

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown, plainExcerpt } from './markdown.mjs';
import { injectAffiliates } from './affiliate.mjs';
import { loadConfig, paths, readPosts, escapeHtml, log } from './util.mjs';

const CSS = `
:root{--bg:#fbfaf8;--fg:#1b1a19;--muted:#6b6764;--line:#e4e0da;--accent:#9a3b5c;--card:#fff;--chip:#f2eeea}
@media (prefers-color-scheme:dark){:root{--bg:#15131a;--fg:#eee9f0;--muted:#a29aac;--line:#2d2836;--accent:#f092ae;--card:#1d1a24;--chip:#241f2d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:44rem;margin:0 auto;padding:0 1.25rem}
header.site{border-bottom:1px solid var(--line);padding:1.35rem 0 0;margin-bottom:2.5rem}
.brandrow{display:flex;flex-wrap:wrap;gap:.75rem;align-items:baseline;justify-content:space-between}
header.site a.brand{font-weight:700;font-size:1.15rem;color:var(--fg);text-decoration:none;letter-spacing:-.01em}
header.site .tagline{margin:0;color:var(--muted);font-size:.9rem}
nav.kat{display:flex;flex-wrap:wrap;gap:.35rem;margin:1rem 0 0;padding-bottom:.9rem}
nav.kat a{font-size:.85rem;color:var(--muted);text-decoration:none;padding:.3rem .7rem;border-radius:999px;background:var(--chip);white-space:nowrap}
nav.kat a:hover{color:var(--fg)}
nav.kat a[aria-current]{background:var(--accent);color:#fff}
h1{font-size:2rem;line-height:1.2;letter-spacing:-.02em;margin:0 0 .5rem}
h2{font-size:1.35rem;line-height:1.3;margin:2.25rem 0 .75rem}
h3{font-size:1.1rem;margin:1.75rem 0 .5rem}
a{color:var(--accent)}
p,ul,ol{margin:0 0 1.1rem}
li{margin-bottom:.4rem}
blockquote{margin:1.5rem 0;padding:.85rem 1.1rem;background:var(--card);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;color:var(--muted);font-size:.94rem}
blockquote p{margin:0}
hr{border:0;border-top:1px solid var(--line);margin:2.5rem 0}
code{background:var(--card);padding:.12em .35em;border-radius:4px;font-size:.9em}
.meta{color:var(--muted);font-size:.875rem;margin-bottom:2rem}
.card{display:block;padding:1.15rem 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.card:hover h2{color:var(--accent)}
.card h2{margin:0 0 .35rem;font-size:1.2rem}
.card p{margin:0;color:var(--muted);font-size:.95rem}
.card .line{display:flex;gap:.6rem;align-items:center;color:var(--muted);font-size:.8rem;margin-bottom:.3rem;font-variant-numeric:tabular-nums}
.card .kat{background:var(--chip);padding:.1rem .5rem;border-radius:999px}
footer.site{margin-top:4rem;padding:2rem 0;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
footer.site a{color:var(--muted)}
.tags{margin-top:2.5rem;font-size:.85rem;color:var(--muted)}
.related{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--line)}
.related h2{font-size:1.05rem;margin:0 0 .75rem}
.related ul{list-style:none;padding:0;margin:0}
.related li{margin-bottom:.6rem}
.related a{text-decoration:none}
.related a:hover{text-decoration:underline}
.related span{display:block;color:var(--muted);font-size:.85rem}
#suchfeld{width:100%;padding:.7rem .9rem;font-size:1rem;font-family:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:8px}
#suchfeld:focus{outline:2px solid var(--accent);outline-offset:1px}
#trefferzahl{color:var(--muted);font-size:.875rem;margin:.9rem 0 0}
`;

const SEARCH_JS = `
(function () {
  var feld = document.getElementById('suchfeld');
  var liste = document.getElementById('treffer');
  var zahl = document.getElementById('trefferzahl');
  var daten = [];

  fetch('../suche-index.json')
    .then(function (r) { return r.json(); })
    .then(function (j) { daten = j; zeige(daten); feld.disabled = false; feld.focus(); })
    .catch(function () { zahl.textContent = 'Der Suchindex konnte nicht geladen werden.'; });

  function normal(s) { return (s || '').toLowerCase(); }

  function zeige(treffer, suchbegriff) {
    liste.innerHTML = '';
    if (!suchbegriff) zahl.textContent = daten.length + ' Beitraege insgesamt';
    else if (!treffer.length) zahl.textContent = 'Nichts gefunden fuer "' + suchbegriff + '"';
    else zahl.textContent = treffer.length === 1 ? '1 Treffer' : treffer.length + ' Treffer';

    treffer.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'card';
      a.href = '../' + p.slug + '/';
      a.innerHTML =
        '<span class="line"><span class="kat">' + p.kategorie + '</span><span>' + p.datum + '</span></span>' +
        '<h2></h2><p></p>';
      a.querySelector('h2').textContent = p.titel;
      a.querySelector('p').textContent = p.beschreibung;
      liste.appendChild(a);
    });
  }

  feld.addEventListener('input', function () {
    var q = normal(feld.value).trim();
    if (!q) return zeige(daten);
    var teile = q.split(/\\s+/);
    var treffer = daten.filter(function (p) {
      var heu = normal(p.titel + ' ' + p.beschreibung + ' ' + p.themen.join(' ') + ' ' + p.kategorie);
      return teile.every(function (t) { return heu.indexOf(t) !== -1; });
    });
    zeige(treffer, feld.value.trim());
  });
})();
`;

function formatDefs(niche) {
  return (niche.formats || []).map((f) => ({ ...f, label: f.label || f.id }));
}

function labelFor(defs, id) {
  const f = defs.find((d) => d.id === id);
  return f ? f.label : 'Beitrag';
}

function nav(defs, prefix, aktuell) {
  const links = defs
    .map((f) => `<a href="${prefix}kategorie/${f.id}/"${aktuell === f.id ? ' aria-current="page"' : ''}>${escapeHtml(f.label)}</a>`)
    .join('');
  return `<nav class="kat"><a href="${prefix}"${aktuell === 'start' ? ' aria-current="page"' : ''}>Alle</a>${links}<a href="${prefix}suche/"${aktuell === 'suche' ? ' aria-current="page"' : ''}>Suche</a></nav>`;
}

function layout(site, defs, { title, description, canonical, body, jsonLd, prefix = '', aktuell = '', script = '' }) {
  return `<!doctype html>
<html lang="${site.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="${prefix}feed.xml">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<style>${CSS}</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body>
<header class="site"><div class="wrap">
<div class="brandrow">
<a class="brand" href="${prefix || './'}">${escapeHtml(site.title)}</a>
<p class="tagline">${escapeHtml(site.tagline)}</p>
</div>
${nav(defs, prefix, aktuell)}
</div></header>
<main class="wrap">
${body}
</main>
<footer class="site"><div class="wrap">
<p>${escapeHtml(site.title)} &middot; <a href="${prefix}impressum.html">Impressum</a> &middot; <a href="${prefix}datenschutz.html">Datenschutz</a> &middot; <a href="${prefix}feed.xml">RSS</a></p>
</div></footer>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

// Verwandte Beitraege: gemeinsame Themen zaehlen doppelt, gleiche Artikelform
// einfach. Das haelt Leser auf der Seite, und nur wer weiterliest, klickt
// irgendwann auf einen Affiliate-Link.

function related(post, alle, n = 3) {
  const meineThemen = new Set((post.meta.tags || []).map((t) => String(t).toLowerCase()));

  return alle
    .filter((p) => p.slug !== post.slug)
    .map((p) => {
      const themen = (p.meta.tags || []).filter((t) => meineThemen.has(String(t).toLowerCase())).length;
      return { p, score: themen * 2 + (p.meta.format === post.meta.format ? 1 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(b.p.meta.date).localeCompare(String(a.p.meta.date)))
    .slice(0, n)
    .map((x) => x.p);
}

function card(site, defs, p, prefix) {
  return `<a class="card" href="${prefix}${p.slug}/">
<span class="line"><span class="kat">${escapeHtml(labelFor(defs, p.meta.format))}</span><span>${formatDate(p.meta.date, site.lang)}</span></span>
<h2>${escapeHtml(p.meta.title)}</h2>
<p>${escapeHtml(p.meta.description || plainExcerpt(p.body))}</p>
</a>`;
}

function postPage(site, defs, post, alle) {
  const { body: withLinks } = injectAffiliates(post.body);
  const canonical = `${site.baseUrl}/${post.slug}/`;
  const tags = Array.isArray(post.meta.tags) ? post.meta.tags : [];
  const verwandt = related(post, alle);

  const body = `<article>
<h1>${escapeHtml(post.meta.title)}</h1>
<p class="meta"><time datetime="${post.meta.date}">${formatDate(post.meta.date, site.lang)}</time> &middot; <a href="../kategorie/${post.meta.format}/">${escapeHtml(labelFor(defs, post.meta.format))}</a></p>
${renderMarkdown(withLinks)}
${tags.length ? `<p class="tags">Themen: ${tags.map((t) => escapeHtml(t)).join(' &middot; ')}</p>` : ''}
</article>
${verwandt.length ? `<section class="related">
<h2>Passt dazu</h2>
<ul>${verwandt.map((p) => `<li><a href="../${p.slug}/">${escapeHtml(p.meta.title)}</a><span>${escapeHtml(p.meta.description || '')}</span></li>`).join('')}</ul>
</section>` : ''}
<hr>
<p><a href="../">&larr; Alle Beitraege</a></p>`;

  return layout(site, defs, {
    title: `${post.meta.title} - ${site.title}`,
    description: post.meta.description,
    canonical,
    prefix: '../',
    aktuell: post.meta.format,
    body,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: post.meta.title,
        description: post.meta.description,
        datePublished: post.meta.date,
        dateModified: post.meta.date,
        inLanguage: site.lang,
        keywords: tags.join(', '),
        articleSection: labelFor(defs, post.meta.format),
        author: { '@type': 'Person', name: site.author },
        publisher: { '@type': 'Person', name: site.author },
        isAccessibleForFree: true,
        mainEntityOfPage: canonical,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: site.title, item: `${site.baseUrl}/` },
          { '@type': 'ListItem', position: 2, name: labelFor(defs, post.meta.format), item: `${site.baseUrl}/kategorie/${post.meta.format}/` },
          { '@type': 'ListItem', position: 3, name: post.meta.title },
        ],
      },
    ],
  });
}

function indexPage(site, defs, posts) {
  const cards = posts.slice(0, site.maxPostsOnIndex).map((p) => card(site, defs, p, '')).join('\n');

  const body = `<h1>${escapeHtml(site.title)}</h1>
<p class="meta">${escapeHtml(site.description)}</p>
${cards || '<p>Noch keine Beitraege. Starte die Pipeline mit <code>npm run daily</code>.</p>'}`;

  return layout(site, defs, {
    title: `${site.title} - ${site.tagline}`,
    description: site.description,
    canonical: `${site.baseUrl}/`,
    aktuell: 'start',
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.title,
      alternateName: site.tagline,
      description: site.description,
      url: `${site.baseUrl}/`,
      inLanguage: site.lang,
      publisher: { '@type': 'Person', name: site.author },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${site.baseUrl}/suche/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  });
}

function categoryPage(site, defs, def, posts) {
  const eigene = posts.filter((p) => p.meta.format === def.id);
  const canonical = `${site.baseUrl}/kategorie/${def.id}/`;

  const body = `<h1>${escapeHtml(def.label)}</h1>
<p class="meta">${escapeHtml(def.hinweis || '')} ${eigene.length} ${eigene.length === 1 ? 'Beitrag' : 'Beitraege'}.</p>
${eigene.map((p) => card(site, defs, p, '../../')).join('\n') || '<p>Hier steht noch nichts.</p>'}`;

  return layout(site, defs, {
    title: `${def.label} - ${site.title}`,
    description: `${def.hinweis || def.label} auf ${site.title}.`,
    canonical,
    prefix: '../../',
    aktuell: def.id,
    body,
  });
}

function searchPage(site, defs) {
  const body = `<h1>Suche</h1>
<p class="meta">Tippe ein Stichwort. Die Suche laeuft direkt im Browser, es wird nichts uebertragen.</p>
<input id="suchfeld" type="search" placeholder="Titel, Thema oder Kategorie" autocomplete="off" disabled>
<p id="trefferzahl">Index wird geladen ...</p>
<div id="treffer"></div>`;

  return layout(site, defs, {
    title: `Suche - ${site.title}`,
    description: `Alle Beitraege von ${site.title} durchsuchen.`,
    canonical: `${site.baseUrl}/suche/`,
    prefix: '../',
    aktuell: 'suche',
    body,
    script: SEARCH_JS,
  });
}

function searchIndex(site, defs, posts) {
  return posts.map((p) => ({
    slug: p.slug,
    titel: p.meta.title,
    beschreibung: p.meta.description || plainExcerpt(p.body, 140),
    themen: Array.isArray(p.meta.tags) ? p.meta.tags : [],
    kategorie: labelFor(defs, p.meta.format),
    datum: formatDate(p.meta.date, site.lang),
  }));
}

function legalPage(site, defs, title, slug, html) {
  return layout(site, defs, {
    title: `${title} - ${site.title}`,
    description: `${title} von ${site.title}`,
    canonical: `${site.baseUrl}/${slug}`,
    body: `<h1>${title}</h1>${html}`,
  });
}

function feed(site, posts) {
  const items = posts.slice(0, 20).map((p) => `  <item>
    <title>${escapeHtml(p.meta.title)}</title>
    <link>${site.baseUrl}/${p.slug}/</link>
    <guid isPermaLink="true">${site.baseUrl}/${p.slug}/</guid>
    <pubDate>${new Date(p.meta.date + 'T08:00:00Z').toUTCString()}</pubDate>
    <description>${escapeHtml(p.meta.description || '')}</description>
  </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escapeHtml(site.title)}</title>
  <link>${site.baseUrl}/</link>
  <description>${escapeHtml(site.description)}</description>
  <language>${site.lang}</language>
${items}
</channel></rss>`;
}

// KI-Assistenten haben keinen eigenen Index. ChatGPT sucht ueber Bing, Claude
// ueber Brave, Perplexity ueber einen eigenen Crawler. Auffindbarkeit heisst
// deshalb zweierlei: in den Suchindizes stehen, und den KI-Crawlern den Zugang
// nicht verbieten. Der Platzhalter erlaubte zwar schon alles, viele Betreiber
// pruefen aber auf ihren eigenen Namen. Deshalb hier ausdruecklich.

const KI_CRAWLER = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'Claude-SearchBot',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended', 'Amazonbot',
  'meta-externalagent', 'cohere-ai', 'DuckAssistBot', 'CCBot',
];

function robots(site) {
  const bloecke = KI_CRAWLER.map((name) => `User-agent: ${name}\nAllow: /`).join('\n\n');
  return `# Alle Crawler sind willkommen, auch die von KI-Assistenten.
User-agent: *
Allow: /

${bloecke}

Sitemap: ${site.baseUrl}/sitemap.xml
`;
}

// Nach der Konvention von llmstxt.org: eine kompakte Uebersicht in Markdown,
// damit ein Sprachmodell die Seite erfassen kann, ohne 31 HTML-Dokumente zu
// laden. Kein offizieller Standard, kostet aber nichts.

function llmsTxt(site, defs, posts) {
  const kapitel = defs.map((d) => {
    const eigene = posts.filter((p) => p.meta.format === d.id);
    if (!eigene.length) return '';
    const zeilen = eigene
      .map((p) => `- [${p.meta.title}](${site.baseUrl}/${p.slug}/): ${p.meta.description || ''}`)
      .join('\n');
    return `## ${d.label}\n\n${d.hinweis ? `${d.hinweis}.\n\n` : ''}${zeilen}\n`;
  }).filter(Boolean).join('\n');

  return `# ${site.title}

> ${site.description}

${site.title} ist eine deutschsprachige Website zu Filmen, Serien, Streaming und
Heimkino. Die Beitraege beantworten konkrete Fragen: was sich heute Abend zu
schauen lohnt, welches Geraet oder Abo fuer welchen Zweck passt, und wie sich
ein Heimkino ohne grosses Budget einrichten laesst.

Betreiber: ${site.author}. Beitraege mit Affiliate-Links sind am Textanfang als
Werbung gekennzeichnet. Die Texte entstehen mit Unterstuetzung eines
Sprachmodells und werden redaktionell geprueft.

${kapitel}
## Weiteres

- [Suche](${site.baseUrl}/suche/): alle Beitraege durchsuchen
- [Impressum](${site.baseUrl}/impressum.html)
- [Datenschutz](${site.baseUrl}/datenschutz.html)
`;
}

function sitemap(site, defs, posts) {
  const urls = [
    `${site.baseUrl}/`,
    `${site.baseUrl}/suche/`,
    ...defs.map((d) => `${site.baseUrl}/kategorie/${d.id}/`),
    ...posts.map((p) => `${site.baseUrl}/${p.slug}/`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
}

function formatDate(iso, lang) {
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(lang, {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

export function build() {
  const site = loadConfig('site.json');
  const defs = formatDefs(loadConfig('niche.json'));
  const posts = readPosts();

  fs.rmSync(paths.dist, { recursive: true, force: true });
  fs.mkdirSync(paths.dist, { recursive: true });

  fs.writeFileSync(path.join(paths.dist, 'index.html'), indexPage(site, defs, posts));

  for (const post of posts) {
    const dir = path.join(paths.dist, post.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), postPage(site, defs, post, posts));
  }

  for (const def of defs) {
    const dir = path.join(paths.dist, 'kategorie', def.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), categoryPage(site, defs, def, posts));
  }

  const sucheDir = path.join(paths.dist, 'suche');
  fs.mkdirSync(sucheDir, { recursive: true });
  fs.writeFileSync(path.join(sucheDir, 'index.html'), searchPage(site, defs));
  fs.writeFileSync(path.join(paths.dist, 'suche-index.json'), JSON.stringify(searchIndex(site, defs, posts)));

  const legalDir = path.join(paths.site, 'legal');
  for (const [file, title] of [['impressum.html', 'Impressum'], ['datenschutz.html', 'Datenschutz']]) {
    const src = path.join(legalDir, file);
    const html = fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : '<p>Fehlt.</p>';
    fs.writeFileSync(path.join(paths.dist, file), legalPage(site, defs, title, file, html));
  }

  fs.writeFileSync(path.join(paths.dist, 'feed.xml'), feed(site, posts));
  fs.writeFileSync(path.join(paths.dist, 'sitemap.xml'), sitemap(site, defs, posts));
  fs.writeFileSync(path.join(paths.dist, 'robots.txt'), robots(site));
  fs.writeFileSync(path.join(paths.dist, 'llms.txt'), llmsTxt(site, defs, posts));
  fs.writeFileSync(path.join(paths.dist, '.nojekyll'), '');

  // Schluesseldatei fuer IndexNow. Bing prueft damit, dass wir die Domain
  // wirklich kontrollieren, bevor es gemeldete Adressen annimmt.
  if (site.indexNowKey) {
    fs.writeFileSync(path.join(paths.dist, `${site.indexNowKey}.txt`), site.indexNowKey);
  }

  log('build', `${posts.length} Beitraege, ${defs.length} Kategorien, Suchindex nach dist/`);
  return posts.length;
}
