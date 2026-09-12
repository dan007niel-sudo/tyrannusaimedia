import React from 'react';
import { Check } from 'lucide-react';

/**
 * Kleines Rechteck im echten Seitenverhaeltnis. Zeigt das Format, statt es nur
 * zu benennen — „9:16" muss man lesen, das hohe Rechteck sieht man.
 *
 * Gemeinsam genutzt von Motivwahl und Bewegtbild: dasselbe Format soll auf
 * beiden Screens dasselbe Zeichen haben.
 */
export const RatioGlyph: React.FC<{ ratio: string; on: boolean }> = ({ ratio, on }) => {
  const [w, h] = ratio.split(':').map(Number);
  const size: React.CSSProperties = w >= h
    ? { width: '100%', aspectRatio: `${w} / ${h}` }
    : { height: '100%', aspectRatio: `${w} / ${h}` };
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden="true">
      <span
        className={`block border transition-colors duration-200 ${on ? 'border-svt-green bg-svt-green/15' : 'border-black/30'}`}
        style={size}
      />
    </span>
  );
};

/** Sichtbares Haekchen. Der Zustand haengt damit nie nur an der Flaechenfarbe. */
export const CheckMark: React.FC<{ on: boolean }> = ({ on }) => (
  <span
    aria-hidden="true"
    className={`flex h-5 w-5 shrink-0 items-center justify-center border transition-colors duration-200 ${
      on ? 'border-svt-green bg-svt-green text-svt-cream' : 'border-black/25 bg-white/60'
    }`}
  >
    {on && <Check size={12} strokeWidth={3} />}
  </span>
);
