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
