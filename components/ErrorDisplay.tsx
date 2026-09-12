import React from 'react';
import { AlertTriangle, Ban, Clock, HelpCircle, Pencil, RefreshCw, ShieldAlert, WifiOff, X } from 'lucide-react';

export interface AppError {
  message: string;
  errorType: 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'TIMEOUT' | 'CONTENT_BLOCKED' | 'MODEL_UNAVAILABLE' | 'SERVER_ERROR' | 'NETWORK_ERROR' | 'UPLOAD_INVALID' | 'UPLOAD_TOO_LARGE' | 'UNKNOWN';
  retryable: boolean;
}

interface ErrorDisplayProps {
  error: AppError;
  onRetry?: () => void;
  onAdjustPrompt?: () => void;
  onDismiss: () => void;
}

type Tone = 'block' | 'hint';

/**
 * Fehler in der Farbwelt der Marke.
 *
 * Vorher bekam jeder Fehlertyp seine eigene Tailwind-Standardfarbe — Rot,
 * Orange, Bernstein, Blau, und fuer „Inhalt blockiert" Lila. Die SvT Brand
 * Guideline zeigt Lila zweimal ausdruecklich als falsche Anwendung. Dazu kamen
 * `rounded-sm` und `shadow-sm` in einer Marke ohne Rundungen und Schatten.
 *
 * Unterschieden wird jetzt ueber Symbol und Titel — und ueber genau zwei Toene:
 *
 *   block — etwas ist kaputt oder verboten: schwarze Kante, staerkster Kontrast
 *   hint  — ein zweiter Versuch lohnt sich: Sandkante, wie jeder Hinweis
 *
 * `Record` ueber die Fehler-Union statt ueber `string`: kommt ein Typ dazu,
 * meldet TypeScript die fehlende Zeile, statt still auf „Fehler" zu fallen.
 */
const ERROR_CONFIG: Record<AppError['errorType'], { icon: React.ReactNode; title: string; tone: Tone }> = {
  PERMISSION_DENIED: { icon: <ShieldAlert size={14} />, title: 'Zugriff verweigert', tone: 'block' },
  RATE_LIMITED: { icon: <Clock size={14} />, title: 'Zu viele Anfragen', tone: 'hint' },
  TIMEOUT: { icon: <Clock size={14} />, title: 'Zeitüberschreitung', tone: 'hint' },
  CONTENT_BLOCKED: { icon: <Ban size={14} />, title: 'Inhalt blockiert', tone: 'block' },
  UPLOAD_INVALID: { icon: <AlertTriangle size={14} />, title: 'Upload nicht möglich', tone: 'hint' },
  UPLOAD_TOO_LARGE: { icon: <AlertTriangle size={14} />, title: 'Bild zu groß', tone: 'hint' },
  MODEL_UNAVAILABLE: { icon: <WifiOff size={14} />, title: 'Modell nicht verfügbar', tone: 'block' },
  SERVER_ERROR: { icon: <WifiOff size={14} />, title: 'Serverfehler', tone: 'block' },
  NETWORK_ERROR: { icon: <WifiOff size={14} />, title: 'Keine Verbindung', tone: 'hint' },
  UNKNOWN: { icon: <HelpCircle size={14} />, title: 'Fehler', tone: 'block' },
};

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, onRetry, onAdjustPrompt, onDismiss }) => {
  // Der Server kann einen Typ schicken, den das Frontend (noch) nicht kennt.
  const config = ERROR_CONFIG[error.errorType] ?? ERROR_CONFIG.UNKNOWN;
  const block = config.tone === 'block';
  const canRetry = error.retryable && onRetry;
  const canAdjust = error.errorType === 'CONTENT_BLOCKED' && onAdjustPrompt;

  return (
    // role="alert": Die Meldung wird eingefuegt, wenn etwas schiefgeht — genau
    // dann muss ein Screenreader sie vorlesen, ohne dass jemand danach sucht.
    <div
      role="alert"
      className={`svt-rise mb-8 w-full max-w-5xl border-l-2 bg-svt-cream px-5 py-4 md:px-6 ${block ? 'border-black' : 'border-svt-sand'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <p className={`t-rail flex items-center gap-2 pt-3 ${block ? 'text-black' : 'text-svt-green'}`}>
          <span aria-hidden="true">{config.icon}</span>
          {config.title}
        </p>
        {/* 44 px Tippflaeche. Vorher war „Schliessen" ein winziger Textlink. */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Meldung schließen"
          className="svt-press -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-black/60 hover:text-black"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-black/80">{error.message}</p>

      {canRetry || canAdjust ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="svt-press t-rail inline-flex min-h-[44px] items-center gap-2 bg-svt-green px-4 text-svt-cream hover:bg-black"
            >
              <RefreshCw size={12} aria-hidden="true" /> Erneut versuchen
            </button>
          )}
          {canAdjust && (
            <button
              type="button"
              onClick={onAdjustPrompt}
              className="svt-press t-rail inline-flex min-h-[44px] items-center gap-2 border border-black/30 px-4 text-black hover:border-black"
            >
              <Pencil size={12} aria-hidden="true" /> Eingabe anpassen
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ErrorDisplay;
