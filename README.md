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

## Steuerung als Desktop-Programm

Doppelklick auf **Streamtipp Steuerung** auf dem Desktop. Es oeffnet sich ein
eigenes Fenster ohne Adressleiste und ohne Tabs.

Darin:

- **+1 Beitrag**, **+5**, **+10** oder eine eigene Zahl bis 50
- Vor dem Start steht da, was der Lauf verbrauchen wird: Gegenwert in USD,
  Ausgabe-Token und ungefaehre Dauer. Die Schaetzung kommt aus dem tatsaechlich
  gemessenen Verbrauch der letzten Laeufe, nicht aus einem festen Wert
- Waehrend des Laufs laeuft das Protokoll Zeile fuer Zeile mit
- Bestand nach Kategorie, Woerter, Verbrauchshistorie
- Klicks und Impressionen, sobald ein Search-Console-Export in `data/` liegt
- Stand des Themenplans samt aktivem Saisonthema
- Status der geplanten Aufgabe mit naechstem Lauf

Der Server bindet nur an 127.0.0.1, von aussen ist nichts erreichbar. Ohne
Desktop-Verknuepfung geht es auch so:

```bash
npm run app
```

Bewusst kein Electron: Das waere ein Download von rund 200 MB und ein Berg
Abhaengigkeiten fuer ein Fenster, das Edge auf jedem Windows 11 ohnehin liefert.

## Automatischer Betrieb

Einmal einrichten, danach laeuft alles von selbst, sobald der PC an ist:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\aufgabe-einrichten.ps1
```

Legt eine Aufgabe in der Windows-Aufgabenplanung an, die taeglich um 08:00
`npm run autopilot` startet. War der PC zu der Zeit aus, wird der Lauf
nachgeholt. Andere Uhrzeit mit `-Zeit 19:30`, entfernen mit `-Entfernen`.

Ein Lauf macht der Reihe nach:

1. Messdaten einlesen, falls ein neuer CSV-Export in `data/` liegt
2. Gewichte fuer Artikelformen und Quellen neu berechnen
3. Artikel schreiben und Seite bauen
4. montags zusaetzlich den Wochenrueckblick nach `reports/`
5. committen und pushen, wenn `autopush` in `config/site.json` auf `true` steht

Protokolle landen in `logs/`, ein Fehler in einem Schritt stoppt die anderen
nicht. Probelauf ohne Veroeffentlichung:

```bash
npm run autopilot -- --no-push
```

## Wie sich der Bot verbessert

Der Bot optimiert gegen gemessene Klicks, nicht gegen Vermutungen. Die Daten
kommen aus der Google Search Console, weil sie bei Google entstehen und nicht
im Browser des Lesers. Dadurch braucht die Seite kein Analyse-Skript, keinen
Cookie-Banner und keine Einwilligung.

So kommen die Daten ins Projekt:

1. Search Console oeffnen, Property fuer die Adresse anlegen und bestaetigen
2. Einige Tage warten, bis Impressionen auflaufen
3. Unter Leistung, Seiten auf Exportieren klicken
4. Die CSV-Datei nach `data/` legen

Ab dann rechnet jeder Lauf die Gewichte neu. Zwei Sicherungen verhindern
Ueberreaktion: Unter 10 gemessenen Beitraegen und 20 Klicks bleibt alles wie
konfiguriert, und der Mittelwert jeder Gruppe wird in Richtung des
Gesamtmittels geschrumpft. Ein einzelner Glueckstreffer verschiebt damit wenig.

Der Wochenrueckblick in `reports/` schlaegt konkrete Aenderungen vor. Umsetzen
musst du sie selbst. Der Bot aendert seinen eigenen Code nicht.

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
