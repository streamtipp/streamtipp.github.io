// Statischer Site-Generator. Liest content/posts/*.md und schreibt dist/.
//
// Erzeugt: Startseite, Beitragsseiten, Kategorieseiten nach Artikelform,
// eine Suchseite mit Index, Rechtstexte, Feed, Sitemap, robots.txt, llms.txt.
//
// Gestaltung: Kinosaal. Im Dunkelmodus fast schwarz mit warmem Rotstich,
// Samtrot und Bernstein wie Leuchtreklame. Im Hellmodus ein cremiges
// Programmheft. Zwei bewusste Verzichte:
//
//   Keine Filmplakate oder Szenenbilder. Die sind urheberrechtlich geschuetzt,
//   auf einer monetarisierten Seite ist das ein echtes Abmahnrisiko. Jeder
//   Beitrag bekommt stattdessen ein selbst erzeugtes Plakat.
//
//   Keine Webfonts von Google. Deren Einbindung uebertraegt IP-Adressen an
//   Google, dann stimmt die Datenschutzerklaerung nicht mehr. Es bleiben
//   Systemschriften mit schmalem Schnitt fuer die Ueberschriften.

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown, plainExcerpt } from './markdown.mjs';
import { injectAffiliates } from './affiliate.mjs';
import { loadConfig, paths, readPosts, escapeHtml, log } from './util.mjs';

const ICONS = {
  ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M14.5 6.5v2M14.5 11v2M14.5 15.5v2"/></svg>',
  buch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.8C10.4 5.5 8.2 4.9 4.5 5.2v13.3c3.7-.3 5.9.3 7.5 1.6 1.6-1.3 3.8-1.9 7.5-1.6V5.2c-3.7-.3-5.9.3-7.5 1.6z"/><path d="M12 6.8v13.3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M10.3 8.2v5.1l4.3-2.55z" fill="currentColor"/><path d="M8.5 20h7"/></svg>',
  waage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/><path d="M19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/></svg>',
  suche: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  sonne: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.8 12h2M19.2 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  mond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.2A8 8 0 0 1 9.8 4 8 8 0 1 0 20 14.2z"/></svg>',
};

// Farben des dunklen Saals. Steht einmal hier und wird zweimal eingesetzt:
// fuer die Systemeinstellung und fuer die ausdrueckliche Wahl per Knopf.
const DUNKEL = `
  color-scheme:dark;
  --bg:#0d090e;--bg-2:#161016;--bg-3:#221821;--linie:#2e222b;
  --text:#f3ebe0;--gedaempft:#b3a49b;--akzent:#e8a95c;--gold:#e8a95c;--auf-akzent:#1b100b;
  --kopf:rgba(13,9,14,.82);--schein:rgba(232,169,92,.10);--hinweis:#1e1419;
  --schatten:0 1px 2px rgba(0,0,0,.5),0 14px 34px -18px rgba(0,0,0,.9);
`;

const CSS = `
:root{
  color-scheme:light;
  --bg:#f5eee3;--bg-2:#fffaf3;--bg-3:#ece0cf;--linie:#ddcfba;
  --text:#22151a;--gedaempft:#6b5950;--akzent:#8b2338;--gold:#95581a;--auf-akzent:#fff6ec;
  --kopf:rgba(245,238,227,.86);--schein:rgba(149,88,26,.10);--hinweis:#fbecdc;
  --schatten:0 1px 2px rgba(70,35,20,.06),0 10px 28px -14px rgba(70,35,20,.3);
  --sans:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;
  --display:"Bahnschrift SemiCondensed","Bahnschrift","Avenir Next Condensed","Roboto Condensed","Arial Narrow",system-ui,sans-serif;
  --rand:clamp(1rem,3.5vw,2rem);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DUNKEL}}}
:root[data-theme="dark"]{${DUNKEL}}

*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:6rem}
body{margin:0;min-height:100vh;overflow-x:clip;color:var(--text);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;
  background:radial-gradient(1100px 520px at 50% -220px,var(--schein),transparent 70%) no-repeat,var(--bg)}
a{color:var(--akzent);text-underline-offset:3px}
svg{display:block;max-width:100%}
:focus-visible{outline:2px solid var(--akzent);outline-offset:3px;border-radius:6px}
.wrap{width:100%;max-width:74rem;margin:0 auto;padding-left:var(--rand);padding-right:var(--rand)}
.sprung{position:absolute;left:-999px;top:.5rem;z-index:50;background:var(--akzent);color:var(--auf-akzent);padding:.5rem .9rem;border-radius:8px}
.sprung:focus{left:.5rem}

/* Kopfzeile */
.kopf{position:sticky;top:0;z-index:20;background:var(--kopf);border-bottom:1px solid var(--linie);
  -webkit-backdrop-filter:saturate(1.4) blur(12px);backdrop-filter:saturate(1.4) blur(12px)}
.kopf-innen{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:1.4rem;min-height:3.9rem}
.marke{font:700 1.4rem/1 var(--display);letter-spacing:.01em;color:var(--text);text-decoration:none;white-space:nowrap}
.marke span{color:var(--gold)}
.kat-nav{display:flex;gap:.3rem;overflow-x:auto;scrollbar-width:none}
.kat-nav::-webkit-scrollbar{display:none}
.kat-nav a{flex:none;font-size:.87rem;font-weight:500;color:var(--gedaempft);text-decoration:none;padding:.42rem .85rem;border-radius:999px;transition:background .15s,color .15s}
.kat-nav a:hover{color:var(--text);background:var(--bg-3)}
.kat-nav a[aria-current]{background:var(--akzent);color:var(--auf-akzent)}
.aktionen{display:flex;gap:.4rem}
.icon-knopf{display:grid;place-items:center;width:2.45rem;height:2.45rem;padding:0;border-radius:999px;border:1px solid var(--linie);
  background:var(--bg-2);color:var(--text);cursor:pointer;text-decoration:none;transition:border-color .15s}
.icon-knopf:hover{border-color:var(--gedaempft)}
.icon-knopf svg{width:1.15rem;height:1.15rem}
.icon-knopf[aria-current]{background:var(--akzent);color:var(--auf-akzent);border-color:transparent}
.icon-sonne{display:none}
:root[data-theme="dark"] .icon-sonne{display:block}
:root[data-theme="dark"] .icon-mond{display:none}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]) .icon-sonne{display:block}
  :root:not([data-theme="light"]) .icon-mond{display:none}
}
@media (max-width:759px){
  .kopf-innen{grid-template-columns:minmax(0,1fr) auto;gap:.35rem .8rem;min-height:0;padding-top:.6rem;padding-bottom:.55rem}
  .kat-nav{grid-column:1/-1;grid-row:2;margin:0 calc(-1 * var(--rand));padding:0 var(--rand)}
}

/* Plakate */
.cover{position:relative;isolation:isolate;overflow:hidden;aspect-ratio:16/9;border-radius:12px;color:#f7ede1;
  background:linear-gradient(140deg,var(--c1) 0%,var(--c2) 100%)}
.cover::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(130% 100% at 12% -10%,rgba(255,214,160,.30),transparent 52%)}
.cover::after{content:"";position:absolute;inset:0;z-index:-1;background:repeating-linear-gradient(180deg,rgba(255,255,255,.03) 0 1px,transparent 1px 3px)}
.cover .kat{position:absolute;top:.6rem;left:.6rem;font:700 .64rem/1 var(--sans);letter-spacing:.13em;text-transform:uppercase;
  padding:.36rem .56rem;border-radius:999px;background:rgba(10,5,8,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.cover .glyph{position:absolute;right:.7rem;bottom:-.3rem;font:800 clamp(3.2rem,2.2rem + 3vw,4.6rem)/1 var(--display);letter-spacing:-.03em;text-shadow:0 2px 24px rgba(0,0,0,.35)}
.cover .glyph.ist-icon{bottom:.8rem;right:.9rem}
.cover .glyph svg{width:2.5rem;height:2.5rem}
.v0{--c1:#7a2236;--c2:#1c0a11}
.v1{--c1:#47275d;--c2:#130a1b}
.v2{--c1:#1d4a55;--c2:#081417}
.v3{--c1:#7a4a19;--c2:#1d1008}
.v4{--c1:#243466;--c2:#0a0d1c}
.v5{--c1:#6e2e44;--c2:#200f16}

/* Kacheln */
.karte{display:flex;flex-direction:column;gap:.65rem;min-width:0;text-decoration:none;color:inherit}
.karte .cover{box-shadow:var(--schatten);transition:transform .25s ease}
.karte:hover .cover{transform:translateY(-3px)}
.karte h2,.karte h3{margin:0;font:600 1rem/1.32 var(--sans);color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.karte:hover h2,.karte:hover h3{color:var(--akzent)}
.karte p{margin:-.25rem 0 0;font-size:.86rem;line-height:1.5;color:var(--gedaempft);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.karte .meta{font-size:.75rem;color:var(--gedaempft);letter-spacing:.02em}
.raster{display:grid;gap:clamp(1.2rem,2vw,1.6rem) clamp(.9rem,1.6vw,1.25rem);grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))}

/* Startseite */
.intro{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.35rem 1.5rem;margin:clamp(1.4rem,4vw,2.4rem) 0 0}
.intro h1{font:700 clamp(1.7rem,1.2rem + 2.2vw,2.6rem)/1.05 var(--display);margin:0;letter-spacing:.005em}
.intro p{margin:0;color:var(--gedaempft);font-size:.93rem;max-width:34rem}
.buehne{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:clamp(1rem,2.5vw,1.8rem);margin:clamp(1rem,2.5vw,1.6rem) 0 clamp(2.4rem,5vw,3.4rem)}
.feature{display:block;text-decoration:none;color:inherit;border-radius:16px;box-shadow:var(--schatten)}
.cover.gross{aspect-ratio:auto;min-height:clamp(19rem,38vw,26rem);border-radius:16px;display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(1.1rem,3vw,2rem)}
.cover.gross .glyph{top:.6rem;right:1.2rem;bottom:auto;font-size:clamp(5rem,13vw,9rem);opacity:.24}
.cover.gross .glyph svg{width:clamp(4rem,10vw,6.5rem);height:clamp(4rem,10vw,6.5rem)}
.schleier{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,transparent 25%,rgba(8,4,8,.8))}
.feature-text{position:relative;max-width:36rem}
.eyebrow{display:inline-flex;align-items:center;gap:.5rem;margin:0 0 .6rem;font-size:.72rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#f2b56b}
.eyebrow::before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:#f2b56b;box-shadow:0 0 12px #f2b56b}
.feature h2{font:700 clamp(1.6rem,1.1rem + 2.2vw,2.6rem)/1.08 var(--display);margin:0 0 .6rem;letter-spacing:.005em;text-wrap:balance}
.feature p{margin:0 0 .8rem;color:rgba(247,237,225,.84);font-size:clamp(.92rem,.85rem + .3vw,1.02rem);max-width:32rem}
.feature .meta{font-size:.8rem;color:rgba(247,237,225,.7)}
.feature:hover h2{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:5px}
.programm{display:flex;flex-direction:column;background:var(--bg-2);border:1px solid var(--linie);border-radius:16px;padding:1.1rem 1.1rem .6rem}
.programm h2{font:700 .75rem/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--gedaempft);margin:.2rem .2rem .9rem}
.programm ol{list-style:none;margin:0;padding:0}
.programm li+li{border-top:1px dashed var(--linie)}
.programm li a{display:grid;grid-template-columns:3.4rem minmax(0,1fr);gap:.85rem;align-items:center;padding:.6rem .2rem;text-decoration:none;color:inherit}
.programm strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:600;font-size:.92rem;line-height:1.3;color:var(--text)}
.programm small{display:block;margin-top:.2rem;font-size:.75rem;color:var(--gedaempft)}
.programm li a:hover strong{color:var(--akzent)}
.programm .mehr{margin:auto .2rem 0;padding:.75rem 0 .35rem}
.cover.mini{aspect-ratio:1;border-radius:9px}
.cover.mini .kat{display:none}
.cover.mini .glyph{inset:0;display:grid;place-items:center;font-size:1.45rem;letter-spacing:-.02em}
.cover.mini .glyph svg{width:1.4rem;height:1.4rem}
@media (max-width:899px){.buehne{grid-template-columns:minmax(0,1fr)}}

.abschnitt-kopf{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;margin:0 0 1.1rem}
.abschnitt-kopf h2{font:700 clamp(1.35rem,1.1rem + 1vw,1.75rem)/1.15 var(--display);margin:0;letter-spacing:.005em}
.abschnitt-kopf p{margin:.2rem 0 0;color:var(--gedaempft);font-size:.9rem}
.mehr{flex:none;font-size:.88rem;font-weight:600;text-decoration:none;white-space:nowrap}
.mehr:hover{text-decoration:underline}
.reihe{margin:0 0 clamp(2.4rem,5vw,3.2rem)}
.reihe .raster{grid-template-columns:repeat(4,minmax(0,1fr))}
.verwandt .raster{grid-template-columns:repeat(3,minmax(0,1fr))}
@media (max-width:1023px){
  .reihe .raster{grid-template-columns:repeat(3,minmax(0,1fr))}
  .reihe .raster>:nth-child(4){display:none}
}
@media (max-width:639px){
  .reihe .raster{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;
    margin:0 calc(-1 * var(--rand));padding:0 var(--rand) .3rem;scroll-padding-inline:var(--rand)}
  .reihe .raster::-webkit-scrollbar{display:none}
  .reihe .raster>*{flex:0 0 min(78%,18rem);scroll-snap-align:start}
  .reihe .raster>:nth-child(4){display:flex}
}

/* Unterseiten */
.seitenkopf{margin:clamp(1.6rem,4vw,2.6rem) 0 clamp(1.4rem,3vw,2rem)}
.seitenkopf h1{font:700 clamp(2rem,1.4rem + 2.6vw,3rem)/1.05 var(--display);margin:.55rem 0 .45rem;letter-spacing:.005em}
.seitenkopf p{margin:0;color:var(--gedaempft);max-width:40rem}
.chip{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;text-decoration:none;
  color:var(--gold);padding:.32rem .68rem;border:1px solid currentColor;border-radius:999px}
a.chip:hover{background:var(--bg-3)}
.leer{color:var(--gedaempft)}

/* Beitrag */
.beitrag-kopf{display:grid;grid-template-columns:clamp(8.5rem,16vw,11.5rem) minmax(0,1fr);gap:clamp(1.2rem,3vw,2.2rem);align-items:end;margin:clamp(1.4rem,4vw,2.6rem) 0 clamp(1.6rem,4vw,2.4rem)}
.cover.poster{aspect-ratio:2/3;border-radius:14px;box-shadow:var(--schatten)}
.cover.poster .kat{display:none}
.cover.poster .glyph{font-size:clamp(3.4rem,2.5rem + 3vw,5rem)}
.beitrag-kopf h1{font:700 clamp(1.8rem,1.2rem + 2.6vw,3rem)/1.06 var(--display);margin:.7rem 0;letter-spacing:.005em;text-wrap:balance}
.lead{margin:0 0 .9rem;font-size:clamp(1rem,.95rem + .3vw,1.15rem);color:var(--gedaempft);max-width:38rem}
.beitrag-kopf .meta{margin:0;font-size:.85rem;color:var(--gedaempft)}
@media (max-width:639px){
  .beitrag-kopf{grid-template-columns:minmax(0,1fr);gap:1.1rem}
  .cover.poster{aspect-ratio:16/7}
}
.prosa{max-width:42rem;font-size:clamp(1rem,.96rem + .2vw,1.08rem);line-height:1.78}
.prosa p,.prosa ul,.prosa ol{margin:0 0 1.15rem}
.prosa h2{font:700 clamp(1.35rem,1.15rem + .8vw,1.65rem)/1.2 var(--display);margin:2.4rem 0 .8rem;letter-spacing:.005em}
.prosa h3{font:650 1.12rem/1.3 var(--sans);margin:1.8rem 0 .5rem}
.prosa li{margin-bottom:.45rem}
.prosa li::marker{color:var(--gold)}
.prosa blockquote{margin:0 0 1.8rem;padding:.85rem 1.1rem;border-radius:10px;background:var(--hinweis);border:1px solid var(--linie);border-left:3px solid var(--gold);font-size:.9rem;color:var(--gedaempft)}
.prosa blockquote p{margin:0}
.prosa hr{border:0;border-top:1px solid var(--linie);margin:2.4rem 0}
.themen{display:flex;flex-wrap:wrap;gap:.4rem;margin:2.2rem 0 0;max-width:42rem}
.themen span{font-size:.78rem;padding:.3rem .68rem;border-radius:999px;background:var(--bg-3);color:var(--gedaempft)}
.verwandt{margin:clamp(2.6rem,6vw,3.6rem) 0 0;padding-top:clamp(1.8rem,4vw,2.4rem);border-top:1px solid var(--linie)}
.zurueck{display:inline-block;margin-top:2rem;font-weight:600;text-decoration:none}
.zurueck:hover{text-decoration:underline}

/* Suche */
.suchfeld{position:relative;max-width:40rem;margin:0 0 1.2rem}
.suchfeld svg{position:absolute;left:1rem;top:50%;width:1.15rem;height:1.15rem;transform:translateY(-50%);color:var(--gedaempft);pointer-events:none}
#suchfeld{width:100%;font:inherit;font-size:1.05rem;padding:.9rem 1rem .9rem 2.8rem;border-radius:12px;border:1px solid var(--linie);background:var(--bg-2);color:var(--text);box-shadow:var(--schatten)}
#suchfeld:focus{outline:2px solid var(--akzent);outline-offset:2px}
#trefferzahl{color:var(--gedaempft);font-size:.9rem;margin:0 0 1.3rem}

/* Fusszeile */
.fuss{margin-top:clamp(3rem,8vw,5rem);border-top:1px solid var(--linie);background:var(--bg-2)}
.fuss-innen{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.8rem 1.6rem;padding-top:1.6rem;padding-bottom:1.8rem;font-size:.87rem;color:var(--gedaempft)}
.fuss nav{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem}
.fuss nav a{color:var(--gedaempft);text-decoration:none}
.fuss nav a:hover{color:var(--text)}
.fuss p{margin:0;flex-basis:100%;font-size:.78rem}

@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;

// Laeuft im Kopf vor dem ersten Zeichnen, damit die Seite nicht kurz im
// falschen Modus aufblitzt. Gespeichert wird nur, wenn jemand den Knopf drueckt.
const THEMA_KOPF = String.raw`(function(){try{var t=localStorage.getItem('streamtipp-thema');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;

const THEMA_JS = String.raw`(function(){
var b=document.getElementById('thema');if(!b)return;
function aktuell(){var r=document.documentElement.getAttribute('data-theme');if(r)return r;
  return window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
function beschrifte(){var t=aktuell()==='dark'?'Zum hellen Design wechseln':'Zum dunklen Design wechseln';b.setAttribute('aria-label',t);b.setAttribute('title',t)}
beschrifte();
b.addEventListener('click',function(){
  var neu=aktuell()==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',neu);
  try{localStorage.setItem('streamtipp-thema',neu)}catch(e){}
  var m=document.querySelectorAll('meta[name="theme-color"]');
  for(var i=0;i<m.length;i++){m[i].setAttribute('content',neu==='dark'?'#0d090e':'#f5eee3');m[i].removeAttribute('media')}
  beschrifte();
});
})();`;

const SEARCH_JS = String.raw`(function(){
var ICONS=__ICONS__;
var feld=document.getElementById('suchfeld'),liste=document.getElementById('treffer'),zahl=document.getElementById('trefferzahl'),daten=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/\p{M}/gu,'')}
function cover(p){
  var g=p.glyph.t==='i'
    ?'<span class="glyph ist-icon" aria-hidden="true">'+(ICONS[p.glyph.w]||'')+'</span>'
    :'<span class="glyph" aria-hidden="true">'+esc(p.glyph.w)+'</span>';
  return '<div class="cover v'+p.v+'"><span class="kat">'+esc(p.kategorie)+'</span>'+g+'</div>'}
function zeige(treffer,roh){
  if(!roh)zahl.textContent=daten.length+' Beiträge insgesamt';
  else if(!treffer.length)zahl.textContent='Nichts gefunden für „'+roh+'“';
  else zahl.textContent=treffer.length===1?'1 Treffer':treffer.length+' Treffer';
  liste.innerHTML=treffer.map(function(p){
    return '<a class="karte" href="../'+encodeURIComponent(p.slug)+'/">'+cover(p)+'<h2>'+esc(p.titel)+'</h2><p>'+esc(p.beschreibung)+'</p><span class="meta">'+esc(p.datum)+' · '+p.min+' Min.</span></a>'}).join('')}
function suche(){
  var roh=feld.value.trim(),q=norm(roh);
  if(!q)return zeige(daten,'');
  var teile=q.split(/\s+/);
  zeige(daten.filter(function(p){var heu=norm(p.titel+' '+p.beschreibung+' '+p.themen.join(' ')+' '+p.kategorie);
    return teile.every(function(t){return heu.indexOf(t)!==-1})}),roh)}
fetch('../suche-index.json').then(function(r){return r.json()}).then(function(j){
  daten=j;feld.disabled=false;
  var q=new URLSearchParams(location.search).get('q');if(q)feld.value=q;
  suche();feld.focus();
}).catch(function(){zahl.textContent='Der Suchindex konnte nicht geladen werden.'});
feld.addEventListener('input',function(){
  suche();
  try{var u=new URL(location.href);if(feld.value.trim())u.searchParams.set('q',feld.value.trim());else u.searchParams.delete('q');history.replaceState(null,'',u)}catch(e){}
});
})();`;

// JSON landet in <script>-Bloecken. Ein "</script>" in einem vom Modell
// erzeugten Titel wuerde den Block sonst vorzeitig beenden.
function sicheresJson(wert) {
  return JSON.stringify(wert).replace(/</g, '\\u003c');
}

function formatDefs(niche) {
  return (niche.formats || []).map((f) => ({ ...f, label: f.label || f.id }));
}

function labelFor(defs, id) {
  const f = defs.find((d) => d.id === id);
  return f ? f.label : 'Beitrag';
}

function markeHtml(titel) {
  const m = String(titel).match(/^(.*?)(tipp)$/i);
  return m ? `${escapeHtml(m[1])}<span>${escapeHtml(m[2])}</span>` : escapeHtml(titel);
}

function streuwert(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function variante(slug) {
  return streuwert(slug) % 6;
}

// Was auf dem Plakat steht: ein festes Symbol je Artikelform. Frueher stand bei
// "7 Krimiserien" die Zahl, bei "Acht Buchverfilmungen" aber das Symbol, weil
// das Modell Zahlen mal als Ziffer, mal als Wort schreibt. In einer Reihe sah
// das zufaellig aus. Ein Symbol pro Kategorie ist immer einheitlich.
const SYMBOL_JE_FORM = {
  listicle: 'ticket',
  vergleich: 'waage',
  guide: 'buch',
  'wo-streamen': 'play',
};

function glyphFor(post) {
  return { t: 'i', w: SYMBOL_JE_FORM[post.meta.format] || 'ticket' };
}

function glyphHtml(g) {
  return g.t === 'i'
    ? `<span class="glyph ist-icon" aria-hidden="true">${ICONS[g.w] || ''}</span>`
    : `<span class="glyph" aria-hidden="true">${escapeHtml(g.w)}</span>`;
}

function coverHtml(post, defs, klasse = '', inhalt = '') {
  return `<div class="cover v${variante(post.slug)}${klasse ? ` ${klasse}` : ''}"><span class="kat">${escapeHtml(labelFor(defs, post.meta.format))}</span>${glyphHtml(glyphFor(post))}${inhalt}</div>`;
}

function lesezeit(body) {
  return Math.max(1, Math.round(body.split(/\s+/).length / 200));
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

function kurzDatum(iso, lang) {
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  } catch {
    return iso;
  }
}

function nav(defs, prefix, aktuell) {
  const links = [
    `<a href="${prefix || './'}"${aktuell === 'start' ? ' aria-current="page"' : ''}>Start</a>`,
    ...defs.map((f) => `<a href="${prefix}kategorie/${f.id}/"${aktuell === f.id ? ' aria-current="page"' : ''}>${escapeHtml(f.label)}</a>`),
  ];
  return `<nav class="kat-nav" aria-label="Kategorien">${links.join('')}</nav>`;
}

function layout(site, defs, { title, description, canonical, body, jsonLd, prefix = '', aktuell = '', script = '' }) {
  const start = prefix || './';
  return `<!doctype html>
<html lang="${site.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5eee3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d090e" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="${prefix}feed.xml">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
${site.verification?.google ? `<meta name="google-site-verification" content="${escapeHtml(site.verification.google)}">\n` : ''}${site.verification?.bing ? `<meta name="msvalidate.01" content="${escapeHtml(site.verification.bing)}">\n` : ''}<script>${THEMA_KOPF}</script>
<style>${CSS}</style>
${jsonLd ? `<script type="application/ld+json">${sicheresJson(jsonLd)}</script>` : ''}
</head>
<body>
<a class="sprung" href="#inhalt">Zum Inhalt</a>
<header class="kopf"><div class="wrap kopf-innen">
<a class="marke" href="${start}">${markeHtml(site.title)}</a>
${nav(defs, prefix, aktuell)}
<div class="aktionen">
<a class="icon-knopf" href="${prefix}suche/" aria-label="Suche" title="Suche"${aktuell === 'suche' ? ' aria-current="page"' : ''}>${ICONS.suche}</a>
<button class="icon-knopf" id="thema" type="button" aria-label="Design wechseln">${ICONS.mond.replace('<svg', '<svg class="icon-mond"')}${ICONS.sonne.replace('<svg', '<svg class="icon-sonne"')}</button>
</div>
</div></header>
<main id="inhalt" class="wrap">
${body}
</main>
<footer class="fuss"><div class="wrap fuss-innen">
<a class="marke" href="${start}">${markeHtml(site.title)}</a>
<nav aria-label="Weitere Seiten"><a href="${prefix}suche/">Suche</a><a href="${prefix}feed.xml">RSS</a><a href="${prefix}impressum.html">Impressum</a><a href="${prefix}datenschutz.html">Datenschutz</a></nav>
<p>Beiträge mit Affiliate-Links sind am Textanfang als Werbung gekennzeichnet.</p>
</div></footer>
<script>${THEMA_JS}</script>
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

function karte(site, defs, p, prefix, ebene = 3) {
  return `<a class="karte" href="${prefix}${p.slug}/">
${coverHtml(p, defs)}
<h${ebene}>${escapeHtml(p.meta.title)}</h${ebene}>
<p>${escapeHtml(p.meta.description || plainExcerpt(p.body))}</p>
<span class="meta">${kurzDatum(p.meta.date, site.lang)} · ${lesezeit(p.body)} Min.</span>
</a>`;
}

function postPage(site, defs, post, alle) {
  const { body: withLinks } = injectAffiliates(post.body);
  const canonical = `${site.baseUrl}/${post.slug}/`;
  const tags = Array.isArray(post.meta.tags) ? post.meta.tags : [];
  const verwandt = related(post, alle);
  const label = labelFor(defs, post.meta.format);

  const body = `<article>
<header class="beitrag-kopf">
${coverHtml(post, defs, 'poster')}
<div>
<a class="chip" href="../kategorie/${post.meta.format}/">${escapeHtml(label)}</a>
<h1>${escapeHtml(post.meta.title)}</h1>
${post.meta.description ? `<p class="lead">${escapeHtml(post.meta.description)}</p>` : ''}
<p class="meta"><time datetime="${post.meta.date}">${formatDate(post.meta.date, site.lang)}</time> · ${lesezeit(post.body)} Min. Lesezeit</p>
</div>
</header>
<div class="prosa">
${renderMarkdown(withLinks)}
</div>
${tags.length ? `<div class="themen" aria-label="Themen">${tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
</article>
${verwandt.length ? `<section class="reihe verwandt" aria-labelledby="verwandt">
<div class="abschnitt-kopf"><h2 id="verwandt">Passt dazu</h2></div>
<div class="raster">${verwandt.map((p) => karte(site, defs, p, '../')).join('')}</div>
</section>` : ''}
<a class="zurueck" href="../">← Alle Beiträge</a>`;

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
        articleSection: label,
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
          { '@type': 'ListItem', position: 2, name: label, item: `${site.baseUrl}/kategorie/${post.meta.format}/` },
          { '@type': 'ListItem', position: 3, name: post.meta.title },
        ],
      },
    ],
  });
}

// Startseite: statt einer langen Liste eine Buehne mit dem neuesten Beitrag,
// daneben das Programm der naechsten neuen, darunter je Kategorie eine Reihe.
function indexPage(site, defs, posts) {
  const intro = `<div class="intro">
<h1>${escapeHtml(site.tagline)}</h1>
<p>${escapeHtml(site.description)}</p>
</div>`;

  if (!posts.length) {
    return layout(site, defs, {
      title: `${site.title} - ${site.tagline}`,
      description: site.description,
      canonical: `${site.baseUrl}/`,
      aktuell: 'start',
      body: `${intro}<p class="leer">Noch keine Beiträge.</p>`,
    });
  }

  const [neuester, ...rest] = posts;
  const programm = rest.slice(0, 5);

  const buehne = `<section class="buehne" aria-label="Neu">
<a class="feature" href="${neuester.slug}/">
${coverHtml(neuester, defs, 'gross', `<span class="schleier"></span><div class="feature-text">
<p class="eyebrow">Neu im Programm</p>
<h2>${escapeHtml(neuester.meta.title)}</h2>
<p>${escapeHtml(neuester.meta.description || plainExcerpt(neuester.body))}</p>
<span class="meta">${formatDate(neuester.meta.date, site.lang)} · ${lesezeit(neuester.body)} Min. Lesezeit</span>
</div>`)}
</a>
${programm.length ? `<aside class="programm" aria-labelledby="programm">
<h2 id="programm">Außerdem neu</h2>
<ol>${programm.map((p) => `<li><a href="${p.slug}/">${coverHtml(p, defs, 'mini')}<span><strong>${escapeHtml(p.meta.title)}</strong><small>${escapeHtml(labelFor(defs, p.meta.format))} · ${kurzDatum(p.meta.date, site.lang)}</small></span></a></li>`).join('')}</ol>
<a class="mehr" href="suche/">Alle ${posts.length} Beiträge durchsuchen →</a>
</aside>` : ''}
</section>`;

  const reihen = defs.map((d) => {
    const eigene = posts.filter((p) => p.meta.format === d.id);
    const gezeigt = eigene.filter((p) => p.slug !== neuester.slug).slice(0, 4);
    if (!gezeigt.length) return '';
    return `<section class="reihe" aria-labelledby="reihe-${d.id}">
<div class="abschnitt-kopf">
<div><h2 id="reihe-${d.id}">${escapeHtml(d.label)}</h2>${d.hinweis ? `<p>${escapeHtml(d.hinweis)}</p>` : ''}</div>
<a class="mehr" href="kategorie/${d.id}/">Alle ${eigene.length} <span aria-hidden="true">→</span></a>
</div>
<div class="raster">${gezeigt.map((p) => karte(site, defs, p, '')).join('')}</div>
</section>`;
  }).join('\n');

  return layout(site, defs, {
    title: `${site.title} - ${site.tagline}`,
    description: site.description,
    canonical: `${site.baseUrl}/`,
    aktuell: 'start',
    body: `${intro}\n${buehne}\n${reihen}`,
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

  const body = `<header class="seitenkopf">
<span class="chip">Kategorie</span>
<h1>${escapeHtml(def.label)}</h1>
<p>${def.hinweis ? `${escapeHtml(def.hinweis)}. ` : ''}${eigene.length} ${eigene.length === 1 ? 'Beitrag' : 'Beiträge'}.</p>
</header>
${eigene.length ? `<div class="raster">${eigene.map((p) => karte(site, defs, p, '../../', 2)).join('')}</div>` : '<p class="leer">Hier steht noch nichts.</p>'}`;

  return layout(site, defs, {
    title: `${def.label} - ${site.title}`,
    description: `${def.hinweis || def.label} auf ${site.title}.`,
    canonical: `${site.baseUrl}/kategorie/${def.id}/`,
    prefix: '../../',
    aktuell: def.id,
    body,
  });
}

function searchPage(site, defs) {
  const body = `<header class="seitenkopf">
<h1>Suche</h1>
<p>Titel, Thema oder Kategorie eintippen. Die Suche läuft direkt in deinem Browser, es wird nichts übertragen.</p>
</header>
<div class="suchfeld">${ICONS.suche}<input id="suchfeld" type="search" placeholder="Zum Beispiel Krimi, Beamer oder Halloween" autocomplete="off" aria-label="Suchbegriff" disabled></div>
<p id="trefferzahl" aria-live="polite">Index wird geladen …</p>
<div id="treffer" class="raster"></div>`;

  const script = SEARCH_JS.replace('__ICONS__', () => sicheresJson(ICONS));

  return layout(site, defs, {
    title: `Suche - ${site.title}`,
    description: `Alle Beiträge von ${site.title} durchsuchen.`,
    canonical: `${site.baseUrl}/suche/`,
    prefix: '../',
    aktuell: 'suche',
    body,
    script,
  });
}

function searchIndex(site, defs, posts) {
  return posts.map((p) => ({
    slug: p.slug,
    titel: p.meta.title,
    beschreibung: p.meta.description || plainExcerpt(p.body, 140),
    themen: Array.isArray(p.meta.tags) ? p.meta.tags : [],
    kategorie: labelFor(defs, p.meta.format),
    datum: kurzDatum(p.meta.date, site.lang),
    min: lesezeit(p.body),
    glyph: glyphFor(p),
    v: variante(p.slug),
  }));
}

function legalPage(site, defs, title, slug, html) {
  return layout(site, defs, {
    title: `${title} - ${site.title}`,
    description: `${title} von ${site.title}`,
    canonical: `${site.baseUrl}/${slug}`,
    body: `<header class="seitenkopf"><h1>${title}</h1></header>\n<div class="prosa">${html}</div>`,
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
// damit ein Sprachmodell die Seite erfassen kann, ohne jede HTML-Seite zu
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
Heimkino. Die Beiträge beantworten konkrete Fragen: was sich heute Abend zu
schauen lohnt, welches Gerät oder Abo für welchen Zweck passt, und wie sich
ein Heimkino ohne großes Budget einrichten lässt.

Betreiber: ${site.author}. Beiträge mit Affiliate-Links sind am Textanfang als
Werbung gekennzeichnet. Die Texte entstehen mit Unterstützung eines
Sprachmodells und werden redaktionell geprüft.

${kapitel}
## Weiteres

- [Suche](${site.baseUrl}/suche/): alle Beiträge durchsuchen
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

  // Alles aus site/static/ landet unveraendert im Wurzelverzeichnis. Dort
  // gehoeren Bestaetigungsdateien von Suchmaschinen hin, die man herunterlaedt
  // und nur ablegen muss.
  const statisch = path.join(paths.site, 'static');
  const nichtKopieren = new Set(['LIESMICH.txt']);
  if (fs.existsSync(statisch)) {
    const kopiert = [];
    for (const f of fs.readdirSync(statisch)) {
      // Punktdateien und die Anleitung bleiben im Projekt, sie haben auf der
      // oeffentlichen Seite nichts verloren.
      if (f.startsWith('.') || nichtKopieren.has(f)) continue;
      const quelle = path.join(statisch, f);
      if (!fs.statSync(quelle).isFile()) continue;
      fs.copyFileSync(quelle, path.join(paths.dist, f));
      kopiert.push(f);
    }
    if (kopiert.length) log('build', `aus site/static uebernommen: ${kopiert.join(', ')}`);
  }

  log('build', `${posts.length} Beitraege, ${defs.length} Kategorien, Suchindex nach dist/`);
  return posts.length;
}
