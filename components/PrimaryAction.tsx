import React from 'react';
import { ArrowRight } from 'lucide-react';

export type ActionState = 'ready' | 'loading' | 'blocked';

interface PrimaryActionProps {
  label: string;
  /** Wird beim Start des Ladens einmal vorgelesen. */
  loadingLabel: string;
  state: ActionState;
  onClick: () => void;
  /** Warum gesperrt — oder was waehrend des Ladens zu erwarten ist. */
  hint?: string | null;
  /** Sichtbarer, sich aendernder Fortschrittstext (z. B. „Feed 4:5 — 1/2 · 45 %"). */
  progressText?: string | null;
  /** Bekannter Fortschritt 0..1. Ohne Wert laeuft beim Laden die unbestimmte Linie. */
  progress?: number | null;
}

/**
 * Der Hauptknopf jeder Ansicht. Drei Zustaende, drei Bilder:
 *
 *   bereit   — volles Dunkelgruen, Pfeil schiebt sich bei Hover
 *   laedt    — Dunkelgruen bleibt, darunter laeuft eine Sandlinie
 *   gesperrt — nur Haarlinie, gedaempfte Schrift, Begruendung darunter
 *
 * Frueher teilten sich „gesperrt" und „laedt" dasselbe ausgewaschene Graugruen
 * (opacity-40 auf Dunkelgruen). Die groesste Flaeche der Seite sah dadurch
 * kaputt aus — und waehrend einer laufenden Generierung sah sie aus wie
 * „nicht moeglich".
 *
 * Vorlesen: Nur der Zustandswechsel wird angesagt (`loadingLabel`), nicht der
 * laufende Prozentwert. Ein `aria-live`, das sich bei jedem Frame aendert,
 * ueberschwemmt einen Screenreader. Den Stand liefert stattdessen ein echtes
 * `progressbar`-Element, das man abfragen kann — ausserhalb des Knopfes, weil
 * Knoepfe ihre Kinder fuer Hilfstechnik flach machen.
 */
export const PrimaryAction: React.FC<PrimaryActionProps> = ({
  label,
  loadingLabel,
  state,
  onClick,
  hint,
  progressText,
  progress,
}) => {
  const loading = state === 'loading';
  const ready = state === 'ready';
  const known = loading && progress != null;
  const fraction = known ? Math.max(0, Math.min(1, progress as number)) : 0;

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={!ready}
        aria-busy={loading}
        className={`svt-press group relative flex w-full items-center justify-between overflow-hidden border px-6 py-5 md:px-8 md:py-6 ${
          loading
            ? 'cursor-wait border-svt-green bg-svt-green text-svt-cream'
            : ready
              ? 'border-svt-green bg-svt-green text-svt-cream hover:border-black hover:bg-black'
              : 'cursor-not-allowed border-svt-green/25 bg-transparent text-black/40'
        }`}
      >
        <span className="t-untertitel tabular text-sm md:text-base">
          {loading ? progressText ?? loadingLabel : label}
        </span>
        <ArrowRight
          size={18}
          aria-hidden="true"
          className={`shrink-0 transition-transform duration-200 ease-svt-out ${ready ? 'group-hover:translate-x-1' : ''}`}
        />
        {loading &&
          (known ? (
            // Bekannter Fortschritt: `scaleX` statt `width` — laeuft auf der GPU.
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-[3px] w-full origin-left bg-svt-sand transition-transform duration-150 ease-linear"
              style={{ transform: `scaleX(${fraction})` }}
            />
          ) : (
            <span aria-hidden="true" className="svt-sweep absolute bottom-0 left-0 h-[2px] w-1/3 bg-svt-sand" />
          ))}
      </button>

      <span className="sr-only" aria-live="polite">
        {loading ? loadingLabel : ''}
      </span>
      {known && (
        <span
          role="progressbar"
          aria-label={loadingLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          className="sr-only"
        />
      )}

      {hint ? <p className="mt-3 text-[13px] text-black/55">{hint}</p> : null}
    </div>
  );
};
