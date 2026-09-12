import { useEffect, useState } from 'react';

export type BackendStatus = 'waking' | 'ready' | 'offline';

/**
 * Ehrlicher Serverzustand statt eines fest verdrahteten „Bereit".
 *
 * Auf Render Free schlaeft der Dienst nach 15 Minuten ohne Anfrage ein und
 * braucht danach bis zu einer Minute (gemessen: 53 s am 10.09.2026). Das alte
 * Abzeichen zeigte waehrenddessen dauerhaft „System Ready" — es log genau in
 * dem Moment, in dem es haette helfen koennen.
 *
 * Nebenwirkung mit Absicht: Die Abfrage beim Laden WECKT den Dienst. Der
 * Kaltstart laeuft damit parallel zum Eintippen von Vers und Thema statt erst
 * nach dem Klick auf „Motive entwickeln" — bis dahin ist er oft schon vorbei.
 *
 * Kostenlos: /api/health ruft kein Modell auf.
 *
 * `ready` verlangt zusaetzlich `api_configured`: Ein Server, der antwortet,
 * aber keinen Schluessel hat, kann nichts erzeugen — das ist nicht „bereit".
 */
export function useBackendStatus(enabled: boolean): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>(enabled ? 'waking' : 'ready');

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const controller = new AbortController();
    // Deutlich laenger als der gemessene Kaltstart, damit ein langsames
    // Aufwachen nicht als „offline" missverstanden wird.
    const timer = window.setTimeout(() => controller.abort(), 90_000);

    fetch('/api/health', { signal: controller.signal, cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { api_configured?: boolean }) => {
        if (alive) setStatus(body.api_configured ? 'ready' : 'offline');
      })
      .catch(() => {
        if (alive) setStatus('offline');
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled]);

  return status;
}
