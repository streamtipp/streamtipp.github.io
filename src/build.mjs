// Statischer Site-Generator. Liest content/posts/*.md und schreibt dist/.

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown, plainExcerpt } from './markdown.mjs';
import { injectAffiliates } from './affiliate.mjs';
import { loadConfig, paths, readPosts, escapeHtml, log } from './util.mjs';

const CSS = `
:root{--bg:#fbfaf8;--fg:#1b1a19;--muted:#6b6764;--line:#e4e0da;--accent:#9a3b5c;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#15131a;--fg:#eee9f0;--muted:#a29aac;--line:#2d2836;--accent:#f092ae;--card:#1d1a24}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:44rem;margin:0 auto;padding:0 1.25rem}
header.site{border-bottom:1px solid var(--line);padding:1.5rem 0;margin-bottom:2.5rem}
header.site .wrap{display:flex;flex-wrap:wrap;gap:.75rem;align-items:baseline;justify-content:space-between}
header.site a.brand{font-weight:700;font-size:1.15rem;color:var(--fg);text-decoration:none;letter-spacing:-.01em}
header.site p{margin:0;color:var(--muted);font-size:.9rem}
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
.card time{display:block;color:var(--muted);font-size:.8rem;margin-bottom:.25rem;font-variant-numeric:tabular-nums}
footer.site{margin-top:4rem;padding:2rem 0;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
footer.site a{color:var(--muted)}
.tags{margin-top:2.5rem;font-size:.85rem;color:var(--muted)}
`;

// Interne Links sind relativ zur aktuellen Seite ("" im Wurzelverzeichnis,
// "../" in einem Beitragsordner). Dadurch funktioniert die Seite lokal, unter
// einem Benutzernamen-Pfad auf GitHub Pages und unter einer eigenen Domain,
// ohne dass irgendwo eine Basis-URL fest verdrahtet ist. Absolut bleiben nur
// canonical, Open Graph, Sitemap und Feed - da verlangen die Standards es.

function layout(site, { title, description, canonical, body, jsonLd, prefix = '' }) {
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
<a class="brand" href="${prefix || './'}">${escapeHtml(site.title)}</a>
<p>${escapeHtml(site.tagline)}</p>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="site"><div class="wrap">
<p>${escapeHtml(site.title)} &middot; <a href="${prefix}impressum.html">Impressum</a> &middot; <a href="${prefix}datenschutz.html">Datenschutz</a> &middot; <a href="${prefix}feed.xml">RSS</a></p>
</div></footer>
</body>
</html>`;
}

function postPage(site, post) {
  const { body: withLinks } = injectAffiliates(post.body);
  const canonical = `${site.baseUrl}/${post.slug}/`;
  const tags = Array.isArray(post.meta.tags) ? post.meta.tags : [];

  const body = `<article>
<h1>${escapeHtml(post.meta.title)}</h1>
<p class="meta"><time datetime="${post.meta.date}">${formatDate(post.meta.date, site.lang)}</time></p>
${renderMarkdown(withLinks)}
${tags.length ? `<p class="tags">Themen: ${tags.map((t) => escapeHtml(t)).join(' &middot; ')}</p>` : ''}
</article>
<hr>
<p><a href="../">&larr; Alle Beitraege</a></p>`;

  return layout(site, {
    title: `${post.meta.title} - ${site.title}`,
    description: post.meta.description,
    canonical,
    prefix: '../',
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.meta.title,
      description: post.meta.description,
      datePublished: post.meta.date,
      dateModified: post.meta.date,
      author: { '@type': 'Person', name: site.author },
      mainEntityOfPage: canonical,
    },
  });
}

function indexPage(site, posts) {
  const cards = posts.slice(0, site.maxPostsOnIndex).map((p) => `<a class="card" href="${p.slug}/">
<time datetime="${p.meta.date}">${formatDate(p.meta.date, site.lang)}</time>
<h2>${escapeHtml(p.meta.title)}</h2>
<p>${escapeHtml(p.meta.description || plainExcerpt(p.body))}</p>
</a>`).join('\n');

  const body = `<h1>${escapeHtml(site.title)}</h1>
<p class="meta">${escapeHtml(site.description)}</p>
${cards || '<p>Noch keine Beitraege. Starte die Pipeline mit <code>npm run daily</code>.</p>'}`;

  return layout(site, {
    title: `${site.title} - ${site.tagline}`,
    description: site.description,
    canonical: `${site.baseUrl}/`,
    body,
  });
}

function legalPage(site, title, slug, html) {
  return layout(site, {
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

function sitemap(site, posts) {
  const urls = [`${site.baseUrl}/`, ...posts.map((p) => `${site.baseUrl}/${p.slug}/`)];
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
  const posts = readPosts();

  fs.rmSync(paths.dist, { recursive: true, force: true });
  fs.mkdirSync(paths.dist, { recursive: true });

  fs.writeFileSync(path.join(paths.dist, 'index.html'), indexPage(site, posts));

  for (const post of posts) {
    const dir = path.join(paths.dist, post.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), postPage(site, post));
  }

  const legalDir = path.join(paths.site, 'legal');
  const legalPages = [
    ['impressum.html', 'Impressum'],
    ['datenschutz.html', 'Datenschutz'],
  ];
  for (const [file, title] of legalPages) {
    const src = path.join(legalDir, file);
    const html = fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : '<p>Fehlt.</p>';
    fs.writeFileSync(path.join(paths.dist, file), legalPage(site, title, file, html));
  }

  fs.writeFileSync(path.join(paths.dist, 'feed.xml'), feed(site, posts));
  fs.writeFileSync(path.join(paths.dist, 'sitemap.xml'), sitemap(site, posts));
  fs.writeFileSync(
    path.join(paths.dist, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${site.baseUrl}/sitemap.xml\n`
  );
  fs.writeFileSync(path.join(paths.dist, '.nojekyll'), '');

  log('build', `${posts.length} Beitraege nach dist/ geschrieben`);
  return posts.length;
}
