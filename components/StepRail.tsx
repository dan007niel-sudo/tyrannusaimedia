import React from 'react';

/**
 * Die Schrittfigur aus der SvT Brand Guideline.
 *
 * Auf der Typografie-Seite der Guideline stehen die vier Schriftebenen als
 *
 *     1 ——————— TITEL
 *     2 ——————— UNTERTITEL
 *
 * — Ziffer, Haarlinie, Label. Diese Figur ist hier die Schrittanzeige der App.
 * Sie ist damit nicht ausgedacht, sondern aus der Marke uebernommen, und sie
 * traegt eine echte Funktion: wo bin ich, was kommt.
 *
 * Der aktive Zustand haengt nie nur an der Farbe: aktiv traegt zusaetzlich die
 * voll gezogene Linie, das sichtbare Label und `aria-current="step"`.
 */

export type StepKey = 'input' | 'brainstorm' | 'result' | 'motion';

export const STEPS: { key: StepKey; label: string }[] = [
  { key: 'input', label: 'Vers' },
  { key: 'brainstorm', label: 'Motiv' },
  { key: 'result', label: 'Bild' },
  { key: 'motion', label: 'Bewegung' },
];

interface StepTrackProps {
  current: StepKey;
  /** Auf dunkler Flaeche invertieren. */
  tone?: 'light' | 'deep';
}

/** Die vier Schritte nebeneinander — Kopfzeile der App. */
export const StepTrack: React.FC<StepTrackProps> = ({ current, tone = 'light' }) => {
  const currentIndex = STEPS.findIndex(s => s.key === current);
  const ink = tone === 'deep' ? 'text-svt-cream' : 'text-black';
  const muted = tone === 'deep' ? 'text-svt-cream/45' : 'text-black/55';

  return (
    <ol className="flex items-center gap-4 md:gap-7" aria-label="Arbeitsschritte">
      {STEPS.map((step, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'upcoming';
        return (
          <li
            key={step.key}
            aria-current={state === 'active' ? 'step' : undefined}
            className={`t-rail flex items-center gap-2 ${state === 'upcoming' ? muted : ink}`}
          >
            <span className="tabular">{i + 1}</span>
            {/* Die Haarlinie. Aktiv zieht sie sich beim Wechsel selbst — der
                `key` erzwingt den Neustart der Animation genau dann. */}
            <span className="relative block h-px w-5 shrink-0 overflow-hidden md:w-8" aria-hidden="true">
              <span className="absolute inset-0 bg-current opacity-25" />
              {state !== 'upcoming' && (
                <span
                  key={`${step.key}-${state}`}
                  className={`absolute inset-0 bg-current ${state === 'active' ? 'svt-draw' : ''}`}
                />
              )}
            </span>
            {/* Auf schmalen Bildschirmen nur das aktive Label — sonst bricht
                die Zeile, und vier Ziffern mit Linien tragen die Info allein. */}
            <span className={state === 'active' ? '' : 'hidden lg:inline'}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
};

interface RailSectionProps {
  index: number;
  label: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Das Layoutprinzip der Guideline: schmale linke Spalte mit dem fetten
 * Grossbuchstaben-Label, breiter Inhaltsblock rechts. Auf dem Handy rueckt das
 * Label ueber den Inhalt, statt eine zu schmale Spalte zu erzwingen.
 */
export const RailSection: React.FC<RailSectionProps> = ({ index, label, children, className = '' }) => (
  <section className={`grid gap-4 md:grid-cols-[var(--rail)_1fr] md:gap-10 ${className}`}>
    <header className="md:pt-1">
      <p className="t-rail flex items-center gap-3 text-svt-green">
        {/* shrink-0: Die Spalte ist 132 px breit, und bei langen Labels wie
            „Aufloesung" hat Flexbox sonst die Linie gestaucht. */}
        <span className="tabular shrink-0">{String(index).padStart(2, '0')}</span>
        <span className="block h-px w-6 shrink-0 bg-current" aria-hidden="true" />
        <span>{label}</span>
      </p>
    </header>
    <div className="min-w-0">{children}</div>
  </section>
);
