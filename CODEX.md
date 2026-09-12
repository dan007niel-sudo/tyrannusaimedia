# CODEX.md

Projektlokale Arbeitsregeln fuer Codex in diesem Repository.

## Arbeitsmodus

- Standard fuer dieses Projekt ist ein plan-orientiertes Vorgehen: erst Ziel klaeren, dann Plan sichtbar machen, dann umsetzen, pruefen und zusammenfassen.
- Bei groesseren Aenderungen wird der Plan waehrend der Arbeit aktualisiert.
- Keine stillen Grossumbauten: Aenderungen bleiben eng am aktuellen Ziel.

## 3-Agent-Workflow

Fuer Feature-, Bugfix- und Release-Arbeiten gilt dieses Rollenmodell:

1. `code-writer`
   - implementiert die geplante Aenderung
   - arbeitet in einem eigenen Worktree oder klar abgegrenzten Dateibereich
   - dokumentiert geaenderte Dateien und Annahmen

2. `code-reviewer`
   - prueft den Patch kritisch auf Bugs, Regressionen, Sicherheit, UX, Datenmodell und fehlende Tests
   - priorisiert Findings nach Risiko
   - fordert Nacharbeit an, bevor deployed wird

3. `deployer`
   - fuehrt finale Checks aus
   - bereitet Commit, Push, PR oder Deployment vor
   - prueft nach dem Deployment Health-Checks und offensichtliche Smoke-Flows

Wenn echte Subagents verfuegbar und vom Nutzer gewuenscht sind, werden diese Rollen als Agenten delegiert. Wenn nicht, arbeitet Codex die Rollen nacheinander sichtbar ab.

## Worktree-Setup

- Fuer parallele Feature-Arbeit werden separate Git-Worktrees verwendet.
- Zielgroesse: 3 bis 5 parallele Features, sofern die Aenderungsbereiche sich sauber trennen lassen.
- Jeder Worktree bekommt einen sprechenden Branch-Namen, z.B. `feature/auth-history`, `fix/image-ratio`, `hardening/upload-validation`.
- Parallele Arbeiten duerfen sich nicht gegenseitig Dateien zuruecksetzen oder ueberschreiben.
- Vor Integration werden die Worktrees einzeln getestet und dann bewusst zusammengefuehrt.

## Lessons Learned

- 2026-09-11
  - Symptom: Keine einzige Eintrittsanimation der App lief je — weder beim Eingabe-Screen noch bei Motivwahl, Ergebnis, Fehleranzeige oder Historie-Leiste. Die Leiste sprang einfach auf.
  - Ursache: Die Klassen `animate-in`, `fade-in`, `slide-in-from-*`, `zoom-in-95` stammen aus dem Plugin `tailwindcss-animate`. Das war nie installiert (`plugins: []` in tailwind.config.js). Tailwind erzeugt fuer unbekannte Klassen einfach nichts — ohne Warnung.
  - Fix: Eigene Keyframes in index.css (`svt-rise`, `svt-stagger`, `svt-develop`, `svt-draw`, `svt-sweep`, `svt-drawer-*`), jeweils mit `prefers-reduced-motion`-Fassung.
  - Praevention/Test: Jede Animationsklasse, die nicht aus dem Tailwind-Kern kommt, gegen tailwind.config pruefen. `grep -rn "animate-in" --include=*.tsx` gehoert in jeden Design-Review.

- 2026-09-11
  - Symptom: `text-[var(--svt-cream)]/45` blieb wirkungslos — der gedaempfte Text hatte volle Deckkraft.
  - Ursache: Tailwind 3 kann einen Deckkraft-Modifikator nicht auf eine CSS-Variable anwenden, deren Wert ein Hex-Code ist. Es entsteht keine Regel, und niemand merkt es.
  - Fix: Markenfarben als echte Tokens in tailwind.config (`svt.green`, `svt.sage`, `svt.sand`, `svt.cream`, `svt.paper`). Damit greift `text-svt-cream/45`.
  - Praevention/Test: Farben nie als Arbitrary-Variable mit Deckkraft-Suffix schreiben.

- 2026-09-11
  - Symptom: Kopflose Chrome-Screenshots bei 390 px zeigten auf jedem Screen rechts abgeschnittenen Inhalt. Eine Messung in echter Handy-Emulation ergab dagegen `scrollWidth = clientWidth` — kein Ueberlauf.
  - Ursache: Chrome klemmt auch kopflos die Fensterbreite auf ein Minimum (`--headless=new` und `--headless=old` gleichermassen). Das Layout entsteht breiter, das Bild wird nur beschnitten. Wer dem Bild glaubt, repariert einen Fehler, den es nicht gibt, und uebersieht den echten: Die Kopfzeile lief bei 375 px tatsaechlich 18 px ueber.
  - Fix: Pruefseite `dist/qa.html` laedt die App in einem iframe der gewuenschten Breite — Media Queries richten sich nach dem iframe, nicht nach dem Fenster. Sie liegt in dist/ und verschwindet mit jedem Build, wird also nie ausgeliefert.
  - Praevention/Test: Handy-Bilder nur ueber das iframe. Ueberlauf zusaetzlich per `scrollWidth` in echter Emulation messen. Achtung: `vh` rechnet im iframe gegen dessen Hoehe, ein 2700 px hohes iframe blaeht `62vh` auf 1674 px auf.

- 2026-09-11
  - Symptom: Der Kopfzeilen-Chip zeigte dauerhaft „System Ready" — auch waehrend Render Free schlief und 53 s zum Aufwachen brauchte.
  - Ursache: Der Text stand fest im Code; es gab keine Abfrage.
  - Fix: `services/backendStatus.ts` fragt beim Laden `/api/health` ab und zeigt „Startet", bis der Server antwortet. Nebenwirkung mit Absicht: Die Abfrage weckt den Dienst, der Kaltstart laeuft parallel zum Eintippen von Vers und Thema.
  - Praevention/Test: Statusanzeigen nie statisch. Was „bereit" sagt, muss es geprueft haben.

- 2026-09-11
  - Symptom: Der Bewegtbild-Screen versprach bei „Story", der Flyer werde oben und unten „unscharf aufgefuellt".
  - Ursache: Commit ef888d3 hat die unscharfe Bildkopie durch einen Farbverlauf aus den Randfarben ersetzt (Geisterschrift im Streifen), den Hinweistext aber nicht angefasst.
  - Fix: Text beschreibt jetzt den Verlauf.
  - Praevention/Test: UI-Texte beschreiben Verhalten. Wer das Verhalten aendert, sucht im selben Commit nach Texten, die es beschreiben.

- 2026-09-11
  - Symptom: Ueberschriften wie „Vom Vers / zum Bild." las ein Screenreader als „Verszum".
  - Ursache: JSX verschluckt den Zeilenumbruch zwischen Text und `<br />`, und `<br />` selbst traegt keinen Wortabstand.
  - Fix: `{' '}` vor jedes `<br />` in Ueberschriften.
  - Praevention/Test: `h1.textContent` nach jeder mehrzeiligen Ueberschrift pruefen.
- 2026-09-10
  - Symptom: Kein Ausfall — beim Deep Dive gefunden, bevor er eintrat. `gemini-2.5-flash-image` (Bildgenerierung UND -bearbeitung) hatte Abschaltung am 02.10.2026, `gemini-3-flash-preview` (Brainstorm) war bereits deprecated. Drei Wochen Vorlauf, niemand haette es gemerkt, bis die App stillsteht.
  - Ursache: Modell-IDs standen als Literale in drei Funktionsruempfen (`server.py` Brainstorm/Generierung/Bearbeitung). Es gab keine Stelle, an der ablesbar war, welche Modelle die App ueberhaupt benutzt — und keinen Anlass, Googles Deprecations-Seite je wieder zu lesen. Verschaerfend: fuer den Brainstorm war urspruenglich eine **Preview**-ID gewaehlt worden. Preview-Fassungen werden ohne Vorlauf abgekuendigt; das ist kein Unfall, sondern ihre Zusage.
  - Fix: IDs zentral in `server.py` (Abschnitt „Modelle"), ueber `TEXT_MODEL`/`IMAGE_MODEL` per ENV ueberschreibbar — ein Modellwechsel ist damit ohne Deploy pruefbar und ohne Rollback zurueckdrehbar. Migriert auf die stabilen `gemini-3.6-flash` und `gemini-3.1-flash-image`.
  - Praevention/Test: Modellwahl immer gegen Googles Deprecations-Seite pruefen, nie aus dem Gedaechtnis — Modellnamen sind der Bereich, in dem Trainingswissen am schnellsten veraltet. Nur stabile IDs. Nach jedem Wechsel alle drei Pfade einmal ECHT aufrufen: `/api/health` meldet `api_configured: true`, sobald ein Schluessel gesetzt ist, und sagt ueber die Existenz des Modells nichts aus.

- 2026-09-10
  - Symptom: „Feed" bedeutet an zwei Stellen der App zwei verschiedene Seitenverhaeltnisse. Das Bildstudio erzeugt 3:4 (`App.tsx:180`, Label „Feed (3:4)" in `ImageWorkspace.tsx:142`), der Bewegtbild-Renderer rechnet mit 4:5 (`motionRenderer.ts` `FORMAT_ASPECT`, Label „Feed 4:5").
  - Ursache: **keine Schlamperei, sondern eine ueberholte Modellgrenze.** Der Eintrag vom 12.05.2026 zeigt: die UI wollte damals schon `Feed (4:5)`, und der Fix war, die Labels auf `3:4` HERUNTERzusetzen — weil das damalige Bildmodell 4:5 nicht konnte. Der Bewegtbild-Renderer entstand spaeter (August) und behielt die urspruengliche Absicht 4:5 bei. Folge bis heute: wer ein Feed-Bild generiert und es danach animiert, bekommt einen stillen Cover-Beschnitt. Der Kommentar im Renderer („bei einer 4:5-Quelle veraendert das nichts") beschreibt eine Quelle, die die App nie erzeugt hat.
  - Fix: `gemini-3.1-flash-image` unterstuetzt 4:5 nativ. Damit ist die Grenze weg und die urspruengliche Absicht wiederhergestellt: Feed = 4:5 in Ratio-Typ, Anforderung, beiden Labels, Demo-Vorschau, Backend-Allowlist und README. **3:4 bleibt in der Allowlist** — bereits gespeicherte Bildreferenzen tragen es, ein Entfernen wuerde die Historie brechen. Neuer Positivtest `test_accepts_feed_four_five`.
  - Praevention/Test: Wenn eine Modellgrenze zu einer Produktentscheidung fuehrt, gehoert der GRUND in die Notiz — sonst sieht die naechste Sitzung nur eine Ungereimtheit und weiss nicht, ob sie ein Fehler oder Absicht war. Und: Formatnamen gehoeren an EINE Stelle, aus der Bild- und Videopfad gemeinsam lesen. Solange beide eigene Tabellen fuehren (`App.tsx` vs. `FORMAT_ASPECT`), faellt eine Abweichung erst dem Nutzer auf.
- Lessons Learned werden projektlokal in dieser Datei gepflegt.
- Bei jedem gefundenen oder behobenen Bug wird ein kurzer Eintrag ergaenzt:
  - Datum
  - Symptom
  - Ursache
  - Fix
  - Praevention/Test
- Eintraege bleiben kurz und praktisch. Ziel ist, denselben Fehler nicht zweimal zu bezahlen.

### Eintraege

- 2026-05-11
  - Symptom: Projekt-Historie konnte ohne Authentifizierung gelesen und Projekte konnten geloescht werden.
  - Ursache: `/api/projects`-Endpunkte waren direkt oeffentlich erreichbar, obwohl Supabase-Persistence live aktiv ist.
  - Fix: History-Reads und Deletes verlangen jetzt `HISTORY_ADMIN_TOKEN` via `X-History-Token`; das UI fragt den Token im Historie-Panel ab.
  - Praevention/Test: Backend-Smoke prueft fehlendes, falsches und korrektes Token; Reviewer-Pruefung muss Auth- und Delete-Endpunkte besonders betrachten.
- 2026-05-12
  - Symptom: Generierte Bildreferenzen konnten mit einer temporaeren KI-Metapher-ID statt der echten Supabase-Metapher-ID gespeichert werden.
  - Ursache: Nach dem Metaphern-Insert wurden die Datenbank-IDs nicht ans Frontend zurueckgeschrieben; `save-images` bekam dadurch potentiell eine nicht existente `metaphor_id`.
  - Fix: Brainstorm-Persistenz ersetzt Metapher-IDs nur nach erfolgreichem DB-Insert mit den Supabase-IDs und gibt sonst keinen `projectId` fuer nachgelagertes Bildspeichern frei.
  - Praevention/Test: Persistence-Flows muessen ID-Ketten Ende-zu-Ende pruefen; API-Smoke deckt die neue `aspectRatios`-Payload fuer Bildreferenzen ab.
- 2026-05-12
  - Symptom: Die UI zeigte `Feed (4:5)`, waehrend die Generierung tatsaechlich `3:4` anforderte.
  - Ursache: Anzeige-Labels waren nicht an das zentrale Aspect-Ratio-Modell und die Request-Erzeugung gekoppelt.
  - Fix: Feed-Labels in Auswahl und Ergebnisansicht auf `Feed (3:4)` korrigiert.
  - Praevention/Test: Bei Format-Aenderungen alle sichtbaren Labels, README-Angaben, TypeScript-Ratios und Backend-Speicherung gemeinsam pruefen.
- 2026-05-12
  - Symptom: Die UI bot `1K`, `2K` und `4K` als Aufloesung an, aber das Backend gab diese Auswahl nicht an Gemini weiter.
  - Ursache: `imageSize` wurde zwar durch Frontend und API transportiert, in `types.ImageConfig` aber nicht gesetzt.
  - Fix: `GenerateImagesRequest.imageSize` wird serverseitig auf `1K | 2K | 4K` validiert und als `image_size` an Gemini uebergeben.
  - Praevention/Test: SDK-Konfigurationen per lokaler Typ-Introspektion pruefen und Request-Felder nur anzeigen, wenn sie technisch verwendet werden.
- 2026-05-12
  - Symptom: Referenzbilder konnten nur ueber Browser-Hinweise eingeschraenkt werden; Backend und Drag-and-drop akzeptierten potentiell ungeeignete oder zu grosse Data-URIs.
  - Ursache: Upload-Schutz war nicht als gemeinsame Client/Server-Regel umgesetzt.
  - Fix: Client validiert JPG/PNG/WebP bis 5MB, Backend validiert MIME, Base64 und Groesse vor Gemini-Aufrufen; Edit-Uploads bekommen ein separates Limit.
  - Praevention/Test: Unit-Tests pruefen Upload-Typ, Groesse und fehlerhafte Data-URIs.
- 2026-05-12
  - Symptom: Teilweise fehlgeschlagene Multi-Format-Generierungen verloren ihre Detailfehler in der UI.
  - Ursache: `/api/generate-images` gab nur `null` pro Format zurueck, aber keine strukturierten Fehler pro Format.
  - Fix: Backend liefert `errors` je Format; Frontend zeigt Teilfehler und behaelt erfolgreiche Formate nutzbar.
  - Praevention/Test: Multi-Format-Flows muessen erfolgreiche und fehlgeschlagene Formate getrennt behandeln.
- 2026-05-12
  - Symptom: Aus der Historie geladene Projekte konnten neue Bildreferenzen falsch zuordnen, gespeicherte Bild-URLs nicht bearbeiten und `/api/save-images` war als Schreib-Endpunkt oeffentlich erreichbar.
  - Ursache: History-Load setzte die Projekt-ID nicht zurueck, der Edit-Endpunkt akzeptierte nur Data-URIs, und die Referenzspeicherung lief ueber einen ungeschuetzten Compatibility-Endpunkt.
  - Fix: History-Load setzt jetzt die echte Projekt-ID, Edit akzeptiert validierte Supabase-Public-URLs, Generierung speichert Referenzen serverseitig und `/api/save-images` verlangt `HISTORY_ADMIN_TOKEN`.
  - Praevention/Test: Backend-Smokes pruefen History-Token fuer Projekt- und Save-Endpunkte; Reviewer-Pruefung muss History-Load plus Edit-Flows gemeinsam betrachten.
- 2026-05-12
  - Symptom: Logo und Schrift waren nur dezent nachgebaut, aber nicht 1:1 aus der Brand Guideline uebernommen.
  - Ursache: Header nutzte ein rekonstruiertes SVG und die App nutzte Inter statt Creato Display als Basisschrift.
  - Fix: Originales Logo-PNG byte-identisch eingebunden, Creato Display lokal als Webfont ergaenzt und die Markenvision in UI und Prompt-Sprache aufgenommen.
  - Praevention/Test: Bei Brand-Aenderungen Logo-Hash gegen die Quelldatei und PDF-Fontliste pruefen.
- 2026-07-26
  - Symptom: Generierte Bilder liessen sich auf dem Mac herunterladen, auf iPhone und iPad in Safari und Chrome aber nicht verlaesslich speichern.
  - Ursache: Das Frontend ignorierte die bereits gespeicherten HTTPS-Bild-URLs und klickte stattdessen programmatisch einen temporaeren Link auf eine grosse `data:image/...`-URL. iOS/iPadOS behandelt diesen Downloadpfad unzuverlaessig.
  - Fix: Gespeicherte sowie eingebettete/bearbeitete Bilder werden ueber gleichurspruengliche Download-Endpunkte mit `Content-Disposition: attachment` ausgeliefert; der native Teilen-/Speichern-Dialog bleibt als Demo-Rueckfall erhalten.
  - Praevention/Test: Backend-Regressionstests pruefen Attachment-Header, sicheren Dateinamen und URL-Allowlisting; Release-QA prueft Download auf Desktop- und Mobile-Viewport.
- 2026-08-01
  - Symptom: Der Bewegtbild-Loop knackte einmal pro Durchlauf sichtbar, obwohl die Zoomkurve cosinus-periodisch und mathematisch exakt geschlossen war.
  - Ursache: Zwei unabhaengige Faelle, in denen ausgerechnet Frame 0 in ein anderes Verarbeitungsregime faellt. (1) Bei Zoom exakt 1,0 verkleinert ffmpeg die ueberabgetastete Vorlage ohne Resampling — Frame 0 war der einzige „scharfe" Frame im Clip. (2) `eq` hat einen Identitaets-Schnellpfad und ueberspringt sich bei `brightness=0`/`saturation=1` komplett — Frame 0 war der einzige Frame ohne Lichtkurve (YAVG 39,98 statt 38,89).
  - Fix: `ZOOM_BASE = 1.015`, damit der Zoom nie exakt 1,0 wird; Lichtpuls um null zentriert (`pulse-0.5`) statt bei null startend, damit `eq` auf keinem Frame neutral ist.
  - Praevention/Test: `test_periodic_presets_loop_exactly` misst die Naht als RMSE gegen einen Nachbarschritt derselben Phase und verlangt bit-genaue Schliessung. Wer an Presets oder Filterkette etwas aendert, misst danach die Naht — Ansehen reicht nicht.
- 2026-08-01
  - Symptom: Die Nahtmessung lieferte plausible Zahlen, verglich aber die falschen Frames — der Fehler in Punkt 1 oben wurde dadurch fast uebersehen.
  - Ursache: `select='eq(n\,0)+eq(n\,239)'` hatte die Kommas escaped UND gequotet. In Anfuehrungszeichen liest ffmpeg `\,` als literales Backslash-Komma, meldet aber keinen Fehler — es laesst dann alle Frames durch, und `-frames:v N` schneidet die ersten N ab. Gemessen wurde also Frame 0 gegen Frame 1.
  - Fix: Kommas im gequoteten Ausdruck nicht escapen. Zusaetzlich `assert_probe_selection_works()` als Kanarienvogel vor jeder Messung.
  - Praevention/Test: `test_probe_selection_actually_filters`. Grundsatz: ein Messwerkzeug, das nicht fehlschlagen kann, misst nichts — jede Messkette braucht einen Test, der sie absichtlich scheitern laesst.
- 2026-08-01
  - Symptom: Abgeschnittene WhatsApp-JPEGs (Header meldet 1080x1350, Datei ist 16 KB) liefen klaglos durch die Quellpruefung.
  - Ursache: Die Erkennung suchte nach `Premature end of JPEG file` — das ist ImageMagicks Wortlaut. ffmpeg 8 meldet denselben Defekt als `EOI missing, emulating` und `component 0 is incomplete`.
  - Fix: `TRUNCATED_MARKERS` deckt beide Wortlaute plus `error while decoding` und `invalid data found` ab; zusaetzlich ein voller Dekodierdurchlauf, weil ffprobe nur den Header liest.
  - Praevention/Test: `test_real_whatsapp_partial_is_rejected` laeuft gegen die echte kaputte Datei, nicht gegen eine synthetisch abgeschnittene — die synthetische wurde erkannt, die echte nicht. Fehlerstrings immer am Werkzeug verifizieren, das sie tatsaechlich ausgibt.
- 2026-08-01
  - Symptom: Der Video-Download antwortete mit 500 statt die Datei zu liefern.
  - Ursache: `safe_download_filename()` leitet die Endung aus einer festen MIME-Tabelle ab, die nur Bildformate kannte. `video/mp4` loeste einen KeyError aus.
  - Fix: `video/mp4` in die Tabelle aufgenommen.
  - Praevention/Test: `test_download_filename_covers_every_served_mime` haelt Tabelle und tatsaechlich ausgelieferte Typen zusammen. Bei neuen Ausgabeformaten immer beide Seiten pruefen.
- 2026-08-01
  - Symptom: Der serverseitige Bewegtbild-Renderer legte die gesamte Live-App lahm. Nach ~25 s Renderzeit kam 502, danach 404 auf den Job.
  - Ursache: Render Free hat 0,1 CPU. ffmpeg hungert den einzigen Worker aus, die Plattform haelt den Dienst fuer tot und startet den Prozess neu — das 404 kam vom leeren In-Memory-Store nach dem Neustart. Kein Timeout, sondern ein Neustart. Betraf schon den kleinstmoeglichen Auftrag (480p, 3 s, ein Format).
  - Fix: `MOTION_ENABLED=0` in Produktion; Rendern in den Browser verlagert (`services/motionRenderer.ts`, Canvas + WebCodecs + mp4-muxer).
  - Praevention/Test: Bei rechenintensiven Funktionen auf kleinen Instanzen ist die Frage nicht „wie lange dauert es", sondern „ueberlebt der Prozess es". Zuerst den kleinstmoeglichen echten Auftrag gegen die Live-Instanz fahren und auf 502/404 achten. Ein Benchmark, der Sekunden misst, beantwortet die Frage gar nicht — `/api/motion/bench` war genau dieser Fehler.
- 2026-08-01
  - Symptom: Ein Render im Browser hing ohne Fehlermeldung; `flush()` kam nie zurueck.
  - Ursache: `VideoEncoder.isConfigSupported()` meldete fuer `avc1.42001f` (Level 3.1) `supported: true`, `configure()` brach bei 1080x1350 dann mit `NotSupportedError` ab (codierte Flaeche ueber dem Level-Limit). Der Encoder war tot, nahm aber weiter Frames entgegen.
  - Fix: `pickCodec()` konfiguriert jeden Kandidaten testweise wirklich, statt der Abfrage zu glauben; `configure()` im Renderpfad ist zusaetzlich in try/catch.
  - Praevention/Test: Faehigkeitsabfragen sind Hinweise, keine Zusagen — die einzige verlaessliche Pruefung ist der echte Aufruf. Gilt fuer WebCodecs genauso wie fuer jede andere `isXSupported`-API.
- 2026-08-01
  - Symptom: Der Nahttest der Browser-Fassung waere am Kriterium „bit-genau null" gescheitert, obwohl das Ergebnis besser war als in ffmpeg.
  - Ursache: Die exakte Null der ffmpeg-Fassung war ein Artefakt der Quantisierung — `zoompan` rundet die Bewegung am Zyklusanfang auf ganze Pixel und damit auf null, dort standen mehrere Frames faelschlich still. Canvas sampelt subpixelgenau und loest diese Bewegung auf.
  - Fix: Kriterium ist das Verhaeltnis Naht zu Nachbarschritt (`SEAM_RATIO_LIMIT = 1.3`), nicht der Absolutwert. Gemessen: atem+licht 0,07 — die Naht ist glatter als ein normaler Frameuebergang.
  - Praevention/Test: Beim Portieren zwischen Technologien nicht die Messwerte der alten Fassung als Zielwert uebernehmen. Erst pruefen, ob der alte Wert die Qualitaet beschreibt oder eine Eigenheit der alten Implementierung.
