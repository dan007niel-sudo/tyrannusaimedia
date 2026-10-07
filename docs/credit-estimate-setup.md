# Geschätzte KI-Reserve einrichten

Die Reserveanzeige ist eine konservative Betriebshilfe. Sie ist **kein live
abgefragter Google-Kontostand**: Für das verwendete Prepaid-Guthaben steht der
App keine verifizierte Balance-API zur Verfügung.

## Einmalige Einrichtung

1. Die Migration
   `supabase/migrations/20261007_credit_estimate.sql` manuell im bestehenden
   Supabase-Projekt ausführen. Sie wurde bewusst nicht automatisch gegen die
   Produktionsdatenbank ausgeführt.
2. Prüfen, dass das Backend weiterhin den vorhandenen Supabase-Service-Role-Key
   nutzt. Browserrollen erhalten weder Tabellen- noch RPC-Zugriff; der Key darf
   nie in Vite- oder Browser-Variablen stehen.
3. Prüfen, dass `HISTORY_ADMIN_TOKEN` gesetzt ist. Derselbe Token schützt die
   Reserve-Konfiguration über `X-History-Token`.
4. In der App **Reserve** öffnen und alle Felder ausfüllen:
   - den aktuell bei Google bestätigten Gesamtstand in USD, nicht nur den
     letzten Aufladebetrag;
   - eine interne Warnschwelle;
   - bewusst konservative All-in-Ansätze für Konzeptphase, Bild 1K/2K/4K und
     Bildbearbeitung;
   - das Alter, nach dem die Schätzung wieder als veraltet gilt.

Die App setzt absichtlich keine Preiswerte voraus. Laut [offizieller Gemini-
Preisseite](https://ai.google.dev/gemini-api/docs/pricing) lagen die reinen
Bildausgabe-Komponenten für `gemini-3.1-flash-image` am 07.10.2026 bei 0,067 USD
(1K), 0,101 USD (2K) und 0,151 USD (4K); Eingabe sowie Text-/Thinking-Tokens
kommen hinzu. Diese Komponenten sind daher keine fertigen All-in-Ansätze und
müssen vor der Eingabe gegen die dann aktuelle Preisseite geprüft werden.

## Verhalten im Betrieb

- Vor jedem Gemini-Aufruf schreibt das Backend atomar eine konservative
  Reservierung. Der Ansatz bleibt auch bei Timeout oder unbekanntem Ausgang
  abgezogen; es findet keine optimistische Rückerstattung statt.
- Während eine KI-Anfrage läuft, lehnt die Bestätigung eines neuen Kontostands
  mit HTTP 409 ab. Nach Abschluss kann der Admin erneut bestätigen. Verwaiste
  Reservierungen, die älter als 15 Minuten sind, werden durch die bewusste
  Bestätigung des aktuellen Providerstands abgeglichen.
- Ein eindeutiger Provider-402 setzt dauerhaft „Guthaben aufgebraucht". Nur ein
  später gestarteter erfolgreicher Provider-Aufruf oder eine neue manuelle
  Kontostandbestätigung hebt dieses Signal auf.
- Datenbank-/Ledgerfehler blockieren die Flyerarbeit nicht. Die Anzeige wechselt
  auf „unbekannt" und verspricht keinen verfügbaren Betrag.
- Nach jedem Backend-Neustart bleibt die öffentliche Anzeige ohne erneute
  Admin-Bestätigung bei „unbekannt". Das ist der gewählte Vertrauensmodus: Ein
  Ausfall unmittelbar vor einem Neustart könnte sonst unbemerkt aus dem
  Prozessspeicher verschwinden. Die Generierung bleibt trotzdem verfügbar.
- Die öffentliche App erhält nur den groben Zustand, keine USD-Beträge,
  Schwellen oder Bestätigungszeiten. Exakte Werte stehen ausschließlich hinter
  dem Historie-Token im Admin-Endpunkt.
- Jede Anzeige trägt den Hinweis: „Nur Verbrauch dieser App; andere Apps und
  automatische Aufladungen sind nicht enthalten." Bei gemeinsamer Nutzung des
  Google-Guthabens muss der Admin den tatsächlichen Stand erneut bestätigen.

## Endpunkte

- `GET /api/credit-status` — öffentlicher grober Zustand ohne Finanzbeträge
- `GET /api/admin/credit-estimate` — geschützte Konfiguration und Detailstatus
- `PUT /api/admin/credit-estimate` — geschützte Bestätigung einer neuen Basis

Die Admin-Endpunkte erwarten `X-History-Token`. Die Migration, Konfiguration und
ein echter Kontostandabgleich sind vor dem Livegang manuelle Betriebsschritte.
