// Provider-Abstraktion. Zwei Wege zum Modell:
//
//   claude-cli  -> ruft die lokal installierte Claude-Code-CLI auf.
//                  Nutzt dein bestehendes Abo, kostet keinen Cent extra.
//   anthropic   -> offizielles SDK mit API-Key. Noetig, wenn die Pipeline
//                  unbeaufsichtigt in GitHub Actions laufen soll.
//
// Beide liefern reinen Text zurueck, damit der Rest der Pipeline nichts
// ueber den Anbieter wissen muss.

import { spawn } from 'node:child_process';

const MODEL = 'claude-opus-5';

// Der kostenpflichtige Weg wird nie von allein gewaehlt. Ein vorhandener
// ANTHROPIC_API_KEY reicht ausdruecklich nicht: nur wer CONTENTBOT_LLM
// bewusst auf "anthropic" setzt, erzeugt eine Rechnung. Sonst laeuft alles
// ueber die CLI und damit im bestehenden Abo.

export function detectProvider() {
  const explicit = process.env.CONTENTBOT_LLM;
  if (explicit) return explicit;
  return 'claude-cli';
}

export async function complete(prompt, { maxTokens = 16000 } = {}) {
  const provider = detectProvider();
  if (provider === 'claude-cli') return viaCli(prompt);
  if (provider === 'anthropic') return viaSdk(prompt, maxTokens);
  if (provider === 'stub') return viaStub(prompt);
  throw new Error(`Unbekannter Provider: ${provider}`);
}

// --- Weg 1: Claude Code CLI -------------------------------------------------

// Verbrauchszaehler fuer den laufenden Prozess. Die CLI meldet pro Aufruf,
// wie viele Token geflossen sind und was das ueber die API gekostet haette.
// Auf einem Abo wird der Dollarwert nicht abgerechnet, er ist der einzige
// vergleichbare Massstab dafuer, wie stark ein Lauf ins Kontingent greift.

export const verbrauch = {
  aufrufe: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  kostenGegenwert: 0,
};

export function verbrauchText() {
  return (
    `${verbrauch.aufrufe} Aufrufe, ${verbrauch.outputTokens.toLocaleString('de-DE')} Ausgabe-Token, ` +
    `Gegenwert ${verbrauch.kostenGegenwert.toFixed(2)} USD`
  );
}

// Verbrauch eines Laufs an die Historie anhaengen. Daraus schaetzt die App
// spaeter, was ein weiterer Artikel kosten wird, statt mit einem fest
// verdrahteten Wert zu raten.

export async function verbrauchSichern(artikel) {
  if (!verbrauch.aufrufe) return;

  const fs = await import('node:fs');
  const path = await import('node:path');
  const { paths } = await import('./util.mjs');
  const datei = path.join(paths.data, 'verbrauch.json');

  let historie = [];
  try {
    historie = JSON.parse(fs.readFileSync(datei, 'utf8'));
    if (!Array.isArray(historie)) historie = [];
  } catch { /* erste Aufzeichnung */ }

  historie.push({
    zeit: new Date().toISOString(),
    artikel,
    aufrufe: verbrauch.aufrufe,
    outputTokens: verbrauch.outputTokens,
    cacheReadTokens: verbrauch.cacheReadTokens,
    kostenGegenwert: Number(verbrauch.kostenGegenwert.toFixed(4)),
  });

  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(datei, JSON.stringify(historie.slice(-500), null, 2) + '\n');
}

// Schaetzung aus der Historie. Ohne Historie die gemessenen Startwerte.
export function schaetzung(historie, anzahl) {
  const brauchbar = (historie || []).filter((e) => e.artikel > 0);
  const artikel = brauchbar.reduce((s, e) => s + e.artikel, 0);

  const proArtikel = artikel >= 3
    ? {
        kosten: brauchbar.reduce((s, e) => s + e.kostenGegenwert, 0) / artikel,
        tokens: brauchbar.reduce((s, e) => s + e.outputTokens, 0) / artikel,
      }
    : { kosten: 0.085, tokens: 4200 };

  return {
    kosten: proArtikel.kosten * anzahl,
    tokens: Math.round(proArtikel.tokens * anzahl),
    proArtikel,
    basis: artikel >= 3 ? `${artikel} gemessene Artikel` : 'Startwerte, noch zu wenig gemessen',
  };
}

function viaCli(prompt) {
  const bin = process.env.CLAUDE_BIN || 'claude';

  // Unter Windows ist "claude" eine .cmd, die nur ueber die Shell startet.
  // Deshalb ein fertiger Kommandostring statt getrennter Argumente: so
  // bleibt der Aufruf identisch und Node warnt nicht wegen shell + args.
  // Der Prompt geht ueber stdin, nie ueber die Kommandozeile.
  const command = `"${bin}" -p --output-format json`;

  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    child.on('error', (e) => reject(
      new Error(
        `Claude-CLI nicht gefunden (${bin}). ` +
        `Installieren mit: npm install -g @anthropic-ai/claude-code\n${e.message}`
      )
    ));

    child.on('close', (code) => {
      const detail = (err + out).trim();
      if (/not logged in|please run \/login/i.test(detail)) {
        return reject(new Error(
          'Claude-CLI ist nicht angemeldet. Einmalig im Terminal "claude" starten, ' +
          'dort /login eingeben und den Browser-Login abschliessen. Danach laeuft die Pipeline.'
        ));
      }
      if (code !== 0) return reject(new Error(`Claude-CLI Exit ${code}: ${detail || 'ohne Meldung'}`));

      let parsed;
      try {
        parsed = JSON.parse(out.replace(/^﻿/, '').trim());
      } catch {
        return reject(new Error(`Antwort der Claude-CLI ist kein JSON: ${out.slice(0, 200)}`));
      }

      if (parsed.is_error) {
        return reject(new Error(`Claude-CLI meldet Fehler: ${parsed.result || parsed.subtype || 'ohne Angabe'}`));
      }

      const u = parsed.usage || {};
      verbrauch.aufrufe += 1;
      verbrauch.outputTokens += u.output_tokens || 0;
      verbrauch.cacheReadTokens += u.cache_read_input_tokens || 0;
      verbrauch.cacheCreationTokens += u.cache_creation_input_tokens || 0;
      verbrauch.kostenGegenwert += parsed.total_cost_usd || 0;

      const text = String(parsed.result || '').trim();
      if (!text) return reject(new Error('Claude-CLI hat leeren Text geliefert.'));
      resolve(text);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// --- Weg 3: Stub ------------------------------------------------------------
//
// Kein Modell, nur ein festes Geruest. Damit laesst sich die ganze Kette
// testen, ohne Token zu verbrauchen: CONTENTBOT_LLM=stub npm run daily

function viaStub(prompt) {
  const hook = (prompt.match(/<aufhaenger>\s*([\s\S]*?)\s*<\/aufhaenger>/) || [, 'Testthema'])[1];
  const title = hook.slice(0, 60).replace(/[:\n]/g, ' ').trim();
  const filler = Array.from({ length: 12 }, (_, i) =>
    `Absatz ${i + 1} dieses Testtexts dient nur dazu, die Pipeline zu pruefen. ` +
    `Er enthaelt keine echten Aussagen und sollte nie veroeffentlicht werden.`
  );

  return Promise.resolve(`---
title: ${title}
description: Testartikel aus dem Stub-Provider, erzeugt ohne Modellaufruf, ausschliesslich zur Pruefung der Pipeline.
tags: [test, stub, pipeline]
---

${filler.slice(0, 3).join(' ')}

## Worum es geht

${filler.slice(3, 6).join(' ')}

- Ein Beamer gehoert in diese Liste.
- Eine Soundbar ebenfalls.
- Dazu ein Streaming-Stick.

## Was du beachten solltest

${filler.slice(6, 9).join(' ')}

### Ein Detail

${filler.slice(9).join(' ')}`);
}

// --- Weg 2: Anthropic SDK ---------------------------------------------------

async function viaSdk(prompt, maxTokens) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('CONTENTBOT_LLM=anthropic gesetzt, aber kein ANTHROPIC_API_KEY vorhanden.');
  }
  process.stdout.write('[llm]   Achtung: kostenpflichtiger API-Weg aktiv, dieser Lauf wird abgerechnet.\n');

  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error('SDK fehlt. Installieren mit: npm install @anthropic-ai/sdk');
  }

  const client = new Anthropic();

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: prompt }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.explanation || message.stop_details?.category || 'ohne Angabe';
    throw new Error(`Modell hat die Anfrage abgelehnt (${why}).`);
  }

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!text) throw new Error('SDK hat keinen Text geliefert.');
  return text;
}
