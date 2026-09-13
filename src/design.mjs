// Gemeinsame Gestaltungsbausteine fuer die Website und die Vorschaubilder.
// Beide muessen dieselbe Farbe und dasselbe Symbol pro Beitrag zeigen, sonst
// sieht ein geteilter Link anders aus als die Kachel auf der Seite.

export const ICONS = {
  ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M14.5 6.5v2M14.5 11v2M14.5 15.5v2"/></svg>',
  buch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.8C10.4 5.5 8.2 4.9 4.5 5.2v13.3c3.7-.3 5.9.3 7.5 1.6 1.6-1.3 3.8-1.9 7.5-1.6V5.2c-3.7-.3-5.9.3-7.5 1.6z"/><path d="M12 6.8v13.3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M10.3 8.2v5.1l4.3-2.55z" fill="currentColor"/><path d="M8.5 20h7"/></svg>',
  waage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/><path d="M19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/></svg>',
  suche: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  sonne: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.8 12h2M19.2 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  mond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.2A8 8 0 0 1 9.8 4 8 8 0 1 0 20 14.2z"/></svg>',
};

// Sechs Plakatfarben: jeweils helle und dunkle Seite des Verlaufs.
export const VARIANTEN = [
  ['#7a2236', '#1c0a11'], // Samtrot
  ['#47275d', '#130a1b'], // Pflaume
  ['#1d4a55', '#081417'], // Petrol
  ['#7a4a19', '#1d1008'], // Bernstein
  ['#243466', '#0a0d1c'], // Nachtblau
  ['#6e2e44', '#200f16'], // Weinrot
];

function streuwert(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function variante(slug) {
  return streuwert(slug) % VARIANTEN.length;
}

// Ein festes Symbol je Artikelform. Frueher stand bei "7 Krimiserien" die
// Zahl, bei "Acht Buchverfilmungen" aber das Symbol, weil das Modell Zahlen
// mal als Ziffer, mal als Wort schreibt. In einer Reihe sah das zufaellig aus.
export const SYMBOL_JE_FORM = {
  listicle: 'ticket',
  vergleich: 'waage',
  guide: 'buch',
  'wo-streamen': 'play',
};

// Favicon: Plakatverlauf in Samtrot mit cremefarbenem Play-Dreieck. Bewusst
// ohne Schrift, weil Systemschriften in SVG-Favicons nicht verlaesslich laden,
// und ohne Ticket-Symbol, das bei 16 Pixeln nicht mehr erkennbar ist.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${VARIANTEN[0][0]}"/><stop offset="1" stop-color="${VARIANTEN[0][1]}"/></linearGradient>
<radialGradient id="l" cx=".15" cy="0" r=".9"><stop offset="0" stop-color="#ffd6a0" stop-opacity=".45"/><stop offset="1" stop-color="#ffd6a0" stop-opacity="0"/></radialGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#g)"/><rect width="64" height="64" rx="14" fill="url(#l)"/>
<path d="M25 18.5v27l22-13.5z" fill="#f7ede1"/>
<circle cx="50" cy="14" r="4" fill="#e8a95c"/>
</svg>`;

export function glyphFor(post) {
  return { t: 'i', w: SYMBOL_JE_FORM[post.meta.format] || 'ticket' };
}
