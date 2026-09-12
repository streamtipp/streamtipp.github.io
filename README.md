# contentbot

Automatisierte Content- und Affiliate-Pipeline. Sucht taeglich Themen, schreibt
Artikel mit einem Sprachmodell, baut daraus eine statische Website und stellt
sie auf GitHub Pages.

Laufende Kosten: null. Kein Hosting, keine API-Rechnung, keine Abos.

## Was der Bot tut und was nicht

Er tut:

- Themen aus oeffentlichen RSS-Feeds ziehen und mit Seed-Themen mischen
- Artikel schreiben, validieren und als Markdown ablegen
- Affiliate-Links und den gesetzlich noetigen Werbehinweis einsetzen
- Eine vollstaendige Website bauen: Startseite, Beitraege, Sitemap, RSS, JSON-LD
- Den Deploy blockieren, solange Impressum oder Datenschutz unvollstaendig sind

Er tut nicht:

- Reichweite erzeugen. Ohne Besucher gibt es keine Provision.
- Sich selbst um Affiliate-Freischaltung, Steuern oder Recht kuemmern.
- Fakten pruefen. Lies die Artikel, bevor du sie veroeffentlichst.

## Schnellstart

```bash
npm run doctor
```

Zeigt, ob Node, Modellzugang, Konfiguration und Feeds in Ordnung sind.

```bash
npm run dry
```

Findet Themen und zeigt sie an, ohne etwas zu schreiben. Kostet keinen Token.

```bash
npm run daily
```

Der echte Lauf. Schreibt die in `config/site.json` unter `postsPerDay`
eingestellte Anzahl Artikel und baut die Seite neu.

```bash
npm run build
npm run serve
```

Nur neu bauen und lokal unter http://localhost:4173 ansehen.

## Modellzugang

Zwei Wege, automatisch erkannt:

| Provider | Wann | Kosten |
| --- | --- | --- |
| `claude-cli` | Standard. Ruft die lokale Claude-Code-CLI auf. | im bestehenden Abo enthalten |
| `anthropic` | Sobald `ANTHROPIC_API_KEY` gesetzt ist. | nach Verbrauch |

Fuer den ersten Weg einmalig installieren:

```bash
npm install -g @anthropic-ai/claude-code
```

Erzwingen laesst sich ein Weg mit `CONTENTBOT_LLM=claude-cli` oder
`CONTENTBOT_LLM=anthropic`.

## Konfiguration

| Datei | Inhalt |
| --- | --- |
| `config/site.json` | Name, Beschreibung, Basis-URL, Artikel pro Tag |
| `config/niche.json` | Nische, Zielgruppe, Tonfall, Artikelformen, Seed-Themen |
| `config/sources.json` | RSS-Feeds fuer die Themenfindung |
| `config/affiliate.json` | Partner-Tag, Werbehinweis, verlinkte Produktbegriffe |

Impressum und Datenschutz liegen als Vorlagen in `site/legal/`. Beide enthalten
Platzhalter, die du ersetzen musst.

## Veroeffentlichen

Die Artikel entstehen lokal, GitHub Actions baut und deployed nur. Dadurch
braucht der Workflow keinen API-Key und bleibt kostenlos.

1. Repository auf GitHub anlegen und pushen
2. Unter Settings, Pages als Quelle GitHub Actions waehlen
3. `baseUrl` in `config/site.json` auf die Pages-URL setzen
4. Nach jedem `npm run daily` committen und pushen

## Taeglich automatisch starten

Windows, Aufgabenplanung:

```powershell
schtasks /create /tn "contentbot" /tr "cmd /c cd /d C:\Users\manue\Desktop\filmdate\contentbot && npm run daily" /sc daily /st 07:00
```

## Struktur

```
config/          Einstellungen
content/posts/   erzeugte Artikel als Markdown, das ist dein Bestand
data/state.json  welche Themen schon verbraucht sind
site/legal/      Impressum- und Datenschutzvorlage
src/             Pipeline
dist/            gebaute Website, nicht im Repo
```

Der naechste Schritt steht in `docs/PLAYBOOK.md`.
