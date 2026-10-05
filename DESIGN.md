---
name: Pleasance-Familie
band:
  # Stufe 1–7. glow für dunklen Grund, deep für hellen Grund und Text
  glow: ["#F2545B", "#FB8C45", "#F2C14E", "#6CCF8E", "#46BFE0", "#8E92F8", "#C39BF2"]
  deep: ["#B3262D", "#A8461A", "#876008", "#1D6A44", "#156A88", "#3B3EA8", "#6A33A0"]
gradient:
  css: linear-gradient(45deg, von, mitte, bis)
  svg: gradientUnits userSpaceOnUse, x1 22 y1 78 → x2 78 y2 22
  flutter: LinearGradient(begin: Alignment.bottomLeft, end: Alignment.topRight)
  text-on-gradient: "#17171A"
neutral:
  light: { paper: "#F4F4F1", surface: "#FFFFFF", ink: "#17171A", muted: "#5E5E66", hairline: "rgba(23, 23, 26, 0.16)" }
  dark: { bg: "#0E0D12", raised: "#16151B", text: "#F2F0EA", muted: "#9A98A3", line: "rgba(255, 255, 255, 0.07)" }
tile:
  grid: 100
  radius: 24
  fill: "#121117"
  stroke: 9, runde Enden und Ecken
  content: 22–78
typography:
  display: Bricolage Grotesque (variabel, wdth 75–80 %, wght 750–800), selbst gehostet
  ui: frei (Geist, Inter oder Systemschrift)
---

## Überblick

Jeder Prototyp ist ein Werkzeug von Pleasance. Man erkennt die Familie an vier Dingen, die überall gleich sind: der dunklen Kachel mit dem Zeichen, der Display-Schrift, dem Farbverlauf und dem Absender. Unterscheiden lassen sich die Produkte über ihr **Zeichen**, das ist die Identität und davon gibt es beliebig viele, und über ihren **Ausschnitt aus dem Farbband**, der die Nachbarschaft zeigt. Benachbarte Produkte dürfen ähnliche Farben haben, denn das Zeichen trennt sie.

## Sprachregel

Farbband, Stufen und ihre Themen sind Werkzeuge für uns. Nach außen werden sie nie benannt, weder in Überschriften noch in Texten, im Marketing oder in Produktbeschreibungen. Sichtbar sind nur Farbe, Zeichen und Absender.

## Farbband

Sieben Stufen, jede mit einem Thema. Das Thema entscheidet, wo ein Produkt zu Hause ist.

| Stufe | Farbe | Thema | glow | deep |
|---|---|---|---|---|
| 1 | Rot | Sicherheit, Körper, Ankommen | `#F2545B` | `#B3262D` |
| 2 | Orange | Kreativität, Genuss, Fluss | `#FB8C45` | `#A8461A` |
| 3 | Gelb | Tatkraft, Feuer, Bauch | `#F2C14E` | `#876008` |
| 4 | Grün | Verbindung, Beziehung | `#6CCF8E` | `#1D6A44` |
| 5 | Türkis | Ausdruck, Kommunikation | `#46BFE0` | `#156A88` |
| 6 | Indigo | Erkenntnis, Klarheit | `#8E92F8` | `#3B3EA8` |
| 7 | Violett | Bewusstsein, das Ganze | `#C39BF2` | `#6A33A0` |

Zwischen zwei Stufen wird linear in sRGB interpoliert. Position 2,5 liegt also genau zwischen Orange und Gelb.

Kontrast: Alle glow-Töne erreichen auf `#0E0D12` mindestens 5,7:1, und `#17171A` auf glow mindestens 5,3:1. Alle deep-Töne und ihre Zwischenwerte erreichen auf Paper mindestens 5,1:1 und taugen damit für Text und Links.

## Produktfarbe

Jedes Produkt bekommt einen Ausschnitt aus dem Farbband. Der Ausschnitt enthält den Ton der eigenen Stufe und läuft in Richtung einer Nachbarstufe, er ist 0,3 bis 1,0 Stufen breit. Daraus ergibt sich ein Verlauf mit drei Stops: von, Mitte, bis. Verlaufsflächen wie Buttons oder die Markierung im Absender nehmen immer die glow-Werte. Die deep-Werte sind für Text, Links und dünne Linien auf hellem Grund, die Mitte des Ausschnitts dient als Akzentfarbe.

| Produkt | Stufe | Ausschnitt | glow (von · Mitte · bis) | deep (von · Mitte · bis) | Zeichen (vorläufig) |
|---|---|---|---|---|---|
| Fahrbar | 1 | 1,00–1,35 | `#F2545B` `#F45E57` `#F56853` | `#B3262D` `#B12C2A` `#AF3126` | Route mit Ziel |
| Music Hub | 2 | 1,35–2,20 | `#F56853` `#F97F4A` `#F99747` | `#AF3126` `#AA3F1E` `#A14B16` | Welle |
| Döner-App | 3 | 2,55–3,20 | `#F6A94A` `#F3BA4D` `#D7C45B` | `#965410` `#8B5D0A` `#726214` | Spieß |
| Fieldtest | 3 | 3,20–3,85 | `#D7C45B` `#ACC870` `#80CD84` | `#726214` `#4F6527` `#2D693B` | Blitz im Rahmen |
| MusicLink | 4 | 3,85–4,55 | `#80CD84` `#64CC9E` `#57C6BB` | `#2D693B` `#1B6A52` `#196A69` | zwei Ringe |
| DocPilot | 5 | 4,75–5,45 | `#50C3CC` `#4DBBE2` `#66ABEB` | `#176A77` `#19668B` `#265696` | Blatt |
| Savor | 6 | 5,50–6,45 | `#6AA9EC` `#8C93F7` `#A696F5` | `#285498` `#3A3FA7` `#5039A4` | Ring mit Kern |
| Khala | 7 | 6,45–7,00 | `#A696F5` `#B499F4` `#C39BF2` | `#5039A4` `#5D36A2` `#6A33A0` | Sternbild |

### Neuer Prototyp

1. Thema bestimmen, daraus folgt die Stufe.
2. Freien Ausschnitt wählen. Liegt auf derselben Stufe schon ein Produkt, sollen sich die Ausschnitte nur teilweise überdecken.
3. Ausschnitt in `APP_BAND` (`packages/shared/src/index.ts`) und `appBand` (`apps/mobile/lib/config.dart`) setzen. Die Farben rechnen `bandColor` und `bandGradient` daraus aus. Das Produkt in die Tabelle oben eintragen, hier im Starter.
4. Zeichen nach den Regeln unten entwerfen und einfarbig in 20 px prüfen.

## Verlauf

Der Verlauf ist das feste Gestaltungsmittel der Familie. Er läuft immer von unten links nach oben rechts.

- Er sitzt dort, wo gehandelt wird: Hauptbutton, aktiver Tab (2-px-Linie), Fortschritt und aktive Zustände wie der gespielte Teil einer Wellenform.
- Text auf dem Verlauf ist immer `#17171A`, nie weiß.
- Kein Verlauf als Seitenhintergrund, in Fließtext oder auf mehr als einer Fläche pro Bildschirmbereich.

## Kachel und Zeichen

Die Kachel ist dunkel (`#121117`, Radius 24 auf dem 100er-Raster), das Zeichen leuchtet darauf im Produktverlauf. Alle Zeichen sind mit derselben Feder gezeichnet:

- Strichstärke 9 auf dem 100er-Raster, runde Enden und Ecken, keine Flächen
- Punkte als gefüllte Kreise mit Radius 5,5 bis 7,5
- Inhalt zwischen 22 und 78, damit alle Zeichen gleich groß wirken
- Einfarbig in 20 px noch unterscheidbar, denn die Form trägt die Identität und nicht die Farbe

Die Zeichen in der Tabelle sind Platzhalter. Ausgearbeitet werden sie in einem eigenen Workshop.

## Typografie

Bricolage Grotesque, selbst gehostet (OFL): im Web unter `apps/web/static/fonts`, in der App unter `apps/mobile/assets/fonts`. Produktname, Überschriften und große Zahlen schmal und fett: wdth 75–80 %, wght 750–800, eng gesetzt. Für Oberflächen und Fließtext ist die Schrift frei, also Geist, Inter oder die Systemschrift.

## Neutrale

Hell: Paper `#F4F4F1`, Ink `#17171A` für Text und Linien, Muted `#5E5E66`. Dunkel: `#0E0D12` als Grund, `#F2F0EA` für Text. Ein Produkt darf den dunklen Grund leicht zu seinem Ton hin färben. Ob ein Produkt hell oder dunkel ist, hängt davon ab, wie es genutzt wird.

## Absender

Jedes Produkt hat in der Fußzeile den Absender „ein Werkzeug von“ und dahinter die Pleasance-Wortmarke in Textfarbe. Fertig gebaut ist das als `PleasanceFooter`, im Web in `$lib/components`, in der App in `lib/core/brand.dart`. Im Web verlinkt der Absender auf https://pleasance.org. Rechts daneben steht das Farbband als 3-px-Linie, abgedunkelt (dunkel: 55 % Schwarz darüber, hell: 60 % Weiß). Der eigene Ausschnitt ist darauf als 9 px hohe Pille im Produktverlauf markiert.

## Pleasance als Dach

Das Dach ist neutral und trägt alle Farben. Die 4-px-Linie unter dem Kopf zeigt das ganze Farbband. Bereiche mit eigener Farbe:

- Coaching: Stufe 4, Ausschnitt 3,80–4,15
- Training: Stufe 5, Ausschnitt 4,85–5,15
- Software: keine eigene Farbe, die Werkzeuge zeigen ihre

Für pleasance.org kommt der Umbau erst nach einer eigenen Mockup-Runde. Bis dahin gilt dort die DESIGN.md im pleasance-Repo.

## Was diese Familie nicht ist

- Keine Kacheln, deren ganze Fläche der Verlauf ist
- Keine weiße Schrift auf Verläufen
- Keine esoterische Symbolik
- Keine Schriften oder Tracker von Dritten beim Seitenaufruf
