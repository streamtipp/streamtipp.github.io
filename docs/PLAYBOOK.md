# Playbook

Der Bot erledigt das Schreiben. Alles, was hier steht, erledigt er nicht.
Ohne diese Schritte laeuft die Pipeline zwar, verdient aber nichts.

## Die ehrliche Rechnung

Grobe Groessenordnungen fuer Amazon-Affiliate in Deutschland. Deine Zahlen
werden abweichen, aber die Reihenfolge stimmt.

| Groesse | Realistischer Wert |
| --- | --- |
| Provision Elektronik und Medien | 1 bis 3 Prozent |
| Durchschnittlicher Warenkorb | 60 bis 100 Euro |
| Provision pro Verkauf | rund 2 Euro |
| Besucher, die auf einen Affiliate-Link klicken | 5 bis 10 Prozent |
| Klicks, die zu einem Kauf fuehren | 3 bis 5 Prozent |

Daraus folgt: etwa 1000 Besucher ergeben rund 3 Verkaeufe und rund 7 Euro.
Fuer 100 Euro im Monat brauchst du also ungefaehr 15.000 Besucher im Monat.
Das ist die eigentliche Aufgabe. Der Bot loest sie nicht.

## Phase 1, Bestand aufbauen

Ziel: 30 Artikel, bevor du irgendwo einen Antrag stellst.

1. `config/niche.json` anpassen. Je enger die Nische, desto besser.
2. `config/site.json` ausfuellen, Platzhalter ersetzen.
3. `site/legal/impressum.html` und `site/legal/datenschutz.html` ausfuellen.
4. Zwei Wochen lang taeglich `npm run daily`.
5. Jeden Artikel lesen, bevor er live geht. Falsche Angaben kosten dich
   Vertrauen und im Ernstfall eine Abmahnung.

Amazon lehnt duenne Seiten ab. Mit fuenf Artikeln brauchst du es nicht zu
versuchen.

## Phase 2, Sichtbarkeit

Suchmaschinen brauchen Monate. Bis dahin musst du Besucher von Hand holen.

- Search Console einrichten und Sitemap einreichen.
- Eine Handvoll Artikel dort teilen, wo die Zielgruppe wirklich ist. Nicht
  spammen, sondern auf konkrete Fragen konkret antworten und den Link nur
  anhaengen, wenn er passt.
- Pinterest funktioniert fuer visuelle Nischen und bringt schneller Klicks als
  Google.
- Einen eigenen Newsletter starten, sobald etwas Traffic da ist. Er gehoert
  dir, anders als jede Plattformreichweite.

Wenn nach drei Monaten und 60 Artikeln nichts passiert, liegt es an der Nische
oder an der Qualitaet, nicht an der Frequenz.

## Phase 3, Monetarisierung

Erst jetzt Affiliate-Programme beantragen.

| Programm | Eignung | Huerde |
| --- | --- | --- |
| Amazon PartnerNet | breite Produktpalette | 3 qualifizierte Verkaeufe in 180 Tagen, sonst Kontoschliessung |
| Awin | Marken und Shops | manuelle Pruefung je Programm |
| Digistore24 | digitale Produkte, hohe Provision | passt nur zu bestimmten Nischen |
| Belboon | deutscher Markt | mittlere Huerde |

Nach der Freischaltung in `config/affiliate.json` den Partner-Tag eintragen und
`amazon.enabled` auf `true` setzen. Vorher nicht, sonst stehen tote Links auf
der Seite.

## Rechtliches, nicht optional

Das ist keine Rechtsberatung. Es sind die Punkte, die sich niemand sparen kann.

- **Impressum** nach § 5 DDG mit ladungsfaehiger Anschrift. Ein Postfach reicht
  nicht. Wer keine Privatadresse veroeffentlichen will, braucht eine
  ladungsfaehige Geschaeftsadresse.
- **Datenschutzerklaerung** nach Art. 13 DSGVO, angepasst an die Dienste, die
  du tatsaechlich einsetzt.
- **Werbekennzeichnung.** Affiliate-Links sind Werbung und muessen erkennbar
  sein, bevor der Leser klickt. Die Pipeline setzt den Hinweis automatisch an
  den Anfang jedes Beitrags mit Links.
- **Gewerbe.** Affiliate-Einnahmen sind in der Regel gewerblich. Anmeldung beim
  Gewerbeamt, dann Fragebogen zur steuerlichen Erfassung beim Finanzamt.
  Die Kleinunternehmerregelung nach § 19 UStG ist am Anfang meist sinnvoll.
- **Steuern.** Einnahmen gehoeren in die Steuererklaerung, auch kleine.
- **KI-Kennzeichnung.** Es gibt in Deutschland keine allgemeine Pflicht, jeden
  KI-Text zu kennzeichnen. Der Hinweis im Impressum ist trotzdem fair und
  kostet nichts.

Der Preflight blockiert den Deploy, solange Impressum oder Datenschutz noch
Platzhalter enthalten. Umgehen kannst du ihn, aber dann traegst du das Risiko.

## Qualitaet, der Punkt, an dem es meistens scheitert

Automatisch erzeugte Massenware rankt nicht mehr. Was hilft:

- Enge Nische statt breiter Themen.
- Eigene Ergaenzungen in die Artikel schreiben. Ein einziger Absatz aus echter
  Erfahrung hebt einen Text ueber den Durchschnitt.
- Artikel, die nach einem halben Jahr niemand liest, loeschen statt liegen
  lassen.
- Lieber zwei gute Artikel pro Woche als zwei mittelmaessige pro Tag. In
  `config/site.json` laesst sich `postsPerDay` jederzeit senken.

## Wann du aufhoeren solltest

Setz dir vorher eine Grenze. Ein brauchbarer Schnitt: nach sechs Monaten und
100 Artikeln ohne nennenswerten Traffic ist die Nische falsch gewaehlt. Dann
lieber neu anfangen als weiterschreiben.
