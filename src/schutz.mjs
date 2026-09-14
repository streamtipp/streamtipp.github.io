// Letzte Kontrolle vor jedem automatischen Commit. Das Repository ist
// öffentlich: Was hier durchrutscht, steht dauerhaft in der Git-Historie und
// ist auch nach dem Löschen über die Commit-Kennung abrufbar.
//
// Zwei Schichten:
// 1. Nur Ordner stagen, die zur Seite gehören. Früher lief "git add -A", und
//    damit wäre jede Datei öffentlich geworden, die zufällig im Projekt liegt,
//    etwa ein Search-Console-Export oder eine Notiz.
// 2. Den vorgemerkten Stand nach Schlüsseln, fremden E-Mail-Adressen und
//    heiklen Dateitypen durchsuchen und im Zweifel abbrechen.

export const VEROEFFENTLICHBAR = ['content', 'site', 'config', 'src', '.github'];

const HEIKLE_DATEIEN = /(^|\/)(\.env[^/]*|.*\.(pem|key|p12|pfx|csv|log|bundle|sqlite|db|kdbx)|.*credentials.*|id_(rsa|ed25519|ecdsa)[^/]*)$/i;

const SCHLUESSEL = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'Anthropic-Schlüssel'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub-Token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub-Token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'privater Schlüssel'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS-Schlüssel'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google-API-Schlüssel'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack-Token'],
  [/"(access|refresh)_?[Tt]oken"\s*:\s*"[^"]{12,}/, 'Zugangstoken'],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Die öffentliche Adresse aus dem Impressum ist erlaubt, alles andere nicht.
// So muss keine private Adresse im Quelltext stehen, um sie abzuwehren.
function erlaubteAdressen(site) {
  return new Set([String(site.email || '').toLowerCase(), 'noreply@anthropic.com']);
}

function adresseErlaubt(adresse, erlaubt) {
  const a = adresse.toLowerCase();
  return erlaubt.has(a) || a.endsWith('@users.noreply.github.com') || /@example\.(com|org|net)$/.test(a);
}

const zeilen = (text) => String(text || '').split(/\r?\n/).map((z) => z.trim()).filter(Boolean);

export function sicherStagen(git) {
  git(['add', '-A', '--', ...VEROEFFENTLICHBAR]);
  return zeilen(git(['diff', '--cached', '--name-only']));
}

// Wirft einen Fehler, wenn der vorgemerkte Stand etwas enthält, das nicht
// öffentlich werden darf. Der Commit unterbleibt dann.
export function pruefeVorCommit(git, site) {
  const probleme = [];

  const identitaet = String(git(['config', 'user.email'])).trim().toLowerCase();
  if (identitaet !== String(site.email || '').toLowerCase()) {
    probleme.push('Die Git-Identität ist nicht die öffentliche Adresse aus config/site.json');
  }

  // Gelöschte Dateien geben nichts preis, die dürfen überall liegen.
  const dateien = zeilen(git(['diff', '--cached', '--name-only']));
  for (const f of zeilen(git(['diff', '--cached', '--name-only', '--diff-filter=d']))) {
    if (!VEROEFFENTLICHBAR.some((o) => f === o || f.startsWith(`${o}/`))) probleme.push(`${f} liegt außerhalb der Seitenordner`);
    if (HEIKLE_DATEIEN.test(f)) probleme.push(`${f} sieht nach einer privaten Datei aus`);
  }

  const erlaubt = erlaubteAdressen(site);
  let datei = '';
  for (const zeile of String(git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff'])).split(/\r?\n/)) {
    if (zeile.startsWith('+++ ')) { datei = zeile.slice(6); continue; }
    if (!zeile.startsWith('+')) continue;
    for (const [muster, name] of SCHLUESSEL) if (muster.test(zeile)) probleme.push(`${name} in ${datei}`);
    for (const adresse of zeile.match(EMAIL) || []) {
      if (!adresseErlaubt(adresse, erlaubt)) probleme.push(`fremde E-Mail-Adresse in ${datei}`);
    }
    if (/\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/i.test(zeile)) probleme.push(`lokaler Benutzerpfad in ${datei}`);
  }

  const eindeutig = [...new Set(probleme)];
  if (eindeutig.length) {
    try { git(['reset', '-q']); } catch { /* egal */ }
    throw new Error(`Nicht veröffentlicht, Sicherheitsprüfung: ${eindeutig.join('; ')}`);
  }
  return dateien;
}
