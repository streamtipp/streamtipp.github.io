// Veroeffentlichen aus der App: pruefen, bauen, committen, pushen, auf den
// Deploy bei GitHub warten, neue Adressen bei Bing melden.
//
// Jeder Schritt meldet sich ueber sende('zeile', ...), damit die App den
// Fortschritt anzeigen kann. Bricht ein Schritt ab, wird nichts veroeffentlicht,
// was nicht vorher geprueft wurde.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT, loadConfig, parseFrontmatter } from './util.mjs';

const WORKFLOW_NAME = 'Seite bauen und veroeffentlichen';

// Pfade, bei deren Aenderung der Workflow in .github/workflows/publish.yml
// ueberhaupt anlaeuft. Aendert sich nur etwas in data/, gibt es keinen Deploy.
const DEPLOY_PFADE = ['content/', 'config/', 'site/', 'src/', '.github/workflows/publish.yml'];

// Wie bei der Claude-CLI: nicht auf PATH verlassen. Die App startet ueber
// wscript, und dort fehlen PATH-Ergaenzungen einer interaktiven Sitzung.
let gitPfad = null;
export function gitBinaer() {
  if (gitPfad) return gitPfad;
  const kandidaten = [
    process.env.GIT_BIN,
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'),
  ].filter(Boolean);
  gitPfad = kandidaten.find((k) => fs.existsSync(k)) || 'git';
  return gitPfad;
}

function git(args) {
  return execFileSync(gitBinaer(), args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

const zeilen = (text) => String(text || '').split(/\r?\n/).map((z) => z.trim()).filter(Boolean);

function titelAus(datei) {
  try {
    const { meta } = parseFrontmatter(fs.readFileSync(path.join(ROOT, datei), 'utf8'));
    return meta.title || path.basename(datei, '.md');
  } catch {
    return path.basename(datei, '.md');
  }
}

// Was liegt lokal, aber noch nicht auf GitHub? Verglichen wird mit origin/main.
// Das ist ohne Netzwerkzugriff moeglich, weil jeder Push von diesem Rechner den
// Stand von origin/main mitaktualisiert.
export function offeneAenderungen() {
  try {
    git(['rev-parse', '--verify', '--quiet', 'origin/main']);
  } catch {
    return { fehler: 'Kein origin/main gefunden. Wurde das Repository schon einmal gepusht?' };
  }

  try {
    const posts = 'content/posts';
    const neuGemeldet = zeilen(git(['diff', '--name-only', '--diff-filter=A', 'origin/main', '--', posts]));
    const unversioniert = zeilen(git(['ls-files', '--others', '--exclude-standard', '--', posts]));
    const neu = [...new Set([...neuGemeldet, ...unversioniert])].filter((f) => f.endsWith('.md'));
    const geaendert = zeilen(git(['diff', '--name-only', '--diff-filter=M', 'origin/main', '--', posts]));
    const geloescht = zeilen(git(['diff', '--name-only', '--diff-filter=D', 'origin/main', '--', posts]));

    const alleDiff = zeilen(git(['diff', '--name-only', 'origin/main']));
    const alleNeu = zeilen(git(['ls-files', '--others', '--exclude-standard']));
    const sonstige = [...new Set([...alleDiff, ...alleNeu])].filter((f) => !f.startsWith(`${posts}/`));

    const voraus = Number(git(['rev-list', '--count', 'origin/main..HEAD']).trim()) || 0;
    const letzterStand = git(['log', '-1', '--format=%cI', 'origin/main']).trim();

    const betrifftSeite = [...neu, ...geaendert, ...geloescht, ...sonstige].some((f) =>
      DEPLOY_PFADE.some((p) => f === p || f.startsWith(p))
    );

    return {
      neu: neu.length,
      geaendert: geaendert.length,
      geloescht: geloescht.length,
      sonstige: sonstige.length,
      voraus,
      ausstehend: neu.length + geaendert.length + geloescht.length + sonstige.length + voraus > 0,
      betrifftSeite,
      neueTitel: neu.slice(0, 8).map(titelAus),
      letzterStand,
    };
  } catch (err) {
    return { fehler: `Git-Abfrage fehlgeschlagen: ${String(err.stderr || err.message).trim()}` };
  }
}

// Laeuft gerade woanders ein Erzeugungslauf, etwa die geplante Aufgabe? Dann
// nicht veroeffentlichen: Genau so ist schon einmal ein halb fertiger Stand mit
// altem Code gebaut worden.
export function andereLaeufe() {
  if (process.platform !== 'win32') return [];
  try {
    const befehl =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'pipeline\\.mjs|autopilot\\.mjs' } | ForEach-Object { $_.ProcessId }";
    const aus = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', befehl], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return zeilen(aus).map(Number).filter((pid) => pid && pid !== process.pid);
  } catch {
    return [];
  }
}

function repoAusRemote() {
  try {
    const url = git(['remote', 'get-url', 'origin']).trim();
    const m = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function kindProzess(args, zeile) {
  return new Promise((resolve) => {
    const kind = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let rest = '';
    const verteile = (stueck) => {
      rest += stueck;
      const teile = rest.split('\n');
      rest = teile.pop();
      for (const t of teile) if (t.trim()) zeile(t.trimEnd());
    };
    kind.stdout.on('data', (d) => verteile(String(d)));
    kind.stderr.on('data', (d) => verteile(String(d)));
    kind.on('close', (code) => {
      if (rest.trim()) zeile(rest.trimEnd());
      resolve(code ?? 1);
    });
    kind.on('error', (err) => {
      zeile(`Fehler: ${err.message}`);
      resolve(1);
    });
  });
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function aufDeployWarten(repo, sha, zeile) {
  const kopf = { 'user-agent': 'contentbot', accept: 'application/vnd.github+json' };
  let zuletzt = '';

  // Bis zu sechs Minuten. Ein normaler Deploy dauert eine bis zwei.
  for (let i = 0; i < 36; i++) {
    let antwort;
    try {
      antwort = await fetch(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=10`, { headers: kopf });
    } catch (err) {
      zeile(`GitHub nicht erreichbar (${err.message}), versuche es weiter ...`);
      await warte(10000);
      continue;
    }

    if (antwort.status === 403 || antwort.status === 429) {
      zeile('GitHub hat das Abfragelimit erreicht. Der Deploy läuft trotzdem, der Status lässt sich nur gerade nicht abfragen.');
      return { unbekannt: true };
    }

    const daten = await antwort.json().catch(() => ({}));
    const laeufe = daten.workflow_runs || [];
    const lauf = laeufe.find((w) => w.name === WORKFLOW_NAME) || laeufe[0];

    if (!lauf) {
      if (zuletzt !== 'wartet') zeile('Warte, bis GitHub den Deploy startet ...');
      zuletzt = 'wartet';
    } else if (lauf.status !== 'completed') {
      const text = lauf.status === 'queued' ? 'Deploy steht in der Warteschlange ...' : 'Deploy läuft ...';
      if (zuletzt !== text) zeile(text);
      zuletzt = text;
    } else {
      return { ok: lauf.conclusion === 'success', ergebnis: lauf.conclusion, link: lauf.html_url };
    }

    await warte(10000);
  }
  return { zeitueberschreitung: true };
}

export async function veroeffentlichen({ sende, probe = false }) {
  const zeile = (text) => sende('zeile', { text });
  const site = loadConfig('site.json');

  const andere = andereLaeufe();
  if (andere.length) {
    zeile(`Abgebrochen: Gerade läuft ein Erzeugungslauf (Prozess ${andere.join(', ')}).`);
    zeile('Warte, bis er fertig ist, sonst würde ein halb fertiger Stand veröffentlicht.');
    return { ok: false };
  }

  const vorher = offeneAenderungen();
  if (vorher.fehler) {
    zeile(`Abgebrochen: ${vorher.fehler}`);
    return { ok: false };
  }
  if (!vorher.ausstehend) {
    zeile('Nichts zu veröffentlichen, alles ist bereits online.');
    return { ok: true, nichts: true };
  }

  const teile = [];
  if (vorher.neu) teile.push(`${vorher.neu} neue${vorher.neu === 1 ? 'r' : ''} Beitr${vorher.neu === 1 ? 'ag' : 'äge'}`);
  if (vorher.geaendert) teile.push(`${vorher.geaendert} geändert`);
  if (vorher.geloescht) teile.push(`${vorher.geloescht} gelöscht`);
  if (vorher.sonstige) teile.push(`${vorher.sonstige} weitere Dateien`);
  zeile(`Zu veröffentlichen: ${teile.join(', ') || `${vorher.voraus} lokale Commits`}.`);

  // Bauen in einem eigenen Prozess, damit der Code von der Platte gilt und nicht
  // der, den dieser Server beim Start geladen hat. Der Build liefert Exit-Code 1,
  // wenn der Preflight etwas blockiert.
  zeile('Baue die Seite und prüfe Impressum, Datenschutz und Partner-Tag ...');
  const buildCode = await kindProzess([path.join(ROOT, 'src', 'pipeline.mjs'), '--build'], zeile);
  if (buildCode !== 0) {
    zeile('Abgebrochen: Der Preflight hat etwas blockiert, siehe oben. Es wurde nichts veröffentlicht.');
    return { ok: false };
  }

  if (probe) {
    zeile('Nur geprüft: Bis hierhin ist alles in Ordnung. Es wurde nichts committet und nichts hochgeladen.');
    return { ok: true, probe: true };
  }

  try {
    git(['add', '-A']);
    const vorgemerkt = zeilen(git(['diff', '--cached', '--name-only']));
    if (vorgemerkt.length) {
      const betreff = vorher.neu
        ? `Veröffentlicht über die App: ${vorher.neu} neue${vorher.neu === 1 ? 'r' : ''} Beitr${vorher.neu === 1 ? 'ag' : 'äge'}`
        : 'Veröffentlicht über die App';
      const koerper = vorher.neueTitel.length ? `\n\n${vorher.neueTitel.map((t) => `- ${t}`).join('\n')}` : '';
      git(['commit', '-m', betreff + koerper]);
      zeile(`Commit erstellt mit ${vorgemerkt.length} Datei${vorgemerkt.length === 1 ? '' : 'en'}.`);
    }
  } catch (err) {
    zeile(`Abgebrochen beim Commit: ${String(err.stderr || err.message).trim()}`);
    return { ok: false };
  }

  zeile('Lade zu GitHub hoch ...');
  try {
    git(['push', 'origin', 'HEAD']);
  } catch (err) {
    zeile(`Hochladen fehlgeschlagen: ${String(err.stderr || err.message).trim()}`);
    zeile('Die Beiträge sind lokal gespeichert und committet, aber nicht online. Häufigste Ursache: Die GitHub-Anmeldung ist abgelaufen. Einmal im Terminal "git push" ausführen, danach funktioniert der Knopf wieder.');
    return { ok: false };
  }

  const sha = git(['rev-parse', 'HEAD']).trim();
  zeile(`Hochgeladen, Stand ${sha.slice(0, 7)}.`);

  const repo = repoAusRemote();
  const deployErwartet = vorher.betrifftSeite || zeilen(git(['diff', '--name-only', `${sha}~1`, sha])).some((f) =>
    DEPLOY_PFADE.some((p) => f === p || f.startsWith(p))
  );

  if (!repo) {
    zeile('Das GitHub-Repository ließ sich nicht bestimmen. Der Deploy läuft trotzdem, der Status wird nur nicht angezeigt.');
    return { ok: true };
  }
  if (!deployErwartet) {
    zeile('An der Seite selbst hat sich nichts geändert, deshalb startet GitHub keinen neuen Deploy.');
    return { ok: true };
  }

  const deploy = await aufDeployWarten(repo, sha, zeile);
  if (deploy.zeitueberschreitung) {
    zeile('Der Deploy dauert ungewöhnlich lange. Hochgeladen ist alles, der Stand erscheint, sobald GitHub fertig ist.');
    return { ok: true };
  }
  if (deploy.unbekannt) return { ok: true };
  if (!deploy.ok) {
    zeile(`Der Deploy bei GitHub ist fehlgeschlagen (${deploy.ergebnis}). Details: ${deploy.link}`);
    return { ok: false };
  }

  zeile('Deploy erfolgreich, die Seite ist aktualisiert.');

  // Erst jetzt melden: Bing prueft die Adressen sofort, und die sollen dann
  // schon den neuen Stand zeigen.
  zeile('Melde die Adressen bei Bing ...');
  await kindProzess([path.join(ROOT, 'src', 'indexnow.mjs')], zeile);

  sende('live', { adresse: site.baseUrl, neu: vorher.neu });
  return { ok: true };
}
