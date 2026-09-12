import React from 'react';
import { AppData, AspectRatio } from '../types';
import { Check, ChevronDown, ChevronLeft } from 'lucide-react';
import { RailSection } from './StepRail';
import { PrimaryAction } from './PrimaryAction';
import { CheckMark, RatioGlyph } from './Marks';

interface MetaphorSelectionProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  onGenerate: () => void;
  onBack: () => void;
  isLoading: boolean;
  isDemoMode?: boolean;
}

type FormatKey = keyof AppData['selectedFormats'];

const RESOLUTIONS = ['1K', '2K', '4K'] as const;

const FIXED_FORMATS: { key: Exclude<FormatKey, 'custom'>; label: string; ratio: string }[] = [
  { key: 'feed', label: 'Feed', ratio: '4:5' },
  { key: 'story', label: 'Story', ratio: '9:16' },
  { key: 'banner', label: 'Banner', ratio: '16:9' },
];

const CUSTOM_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1 · Quadrat' },
  { value: '4:3', label: '4:3 · Standard' },
  { value: '4:5', label: '4:5 · Feed' },
  { value: '3:4', label: '3:4 · Hochformat' },
  { value: '16:9', label: '16:9 · Querformat' },
  { value: '9:16', label: '9:16 · Vertikal' },
];

const MetaphorSelection: React.FC<MetaphorSelectionProps> = ({ data, setData, onGenerate, onBack, isLoading, isDemoMode = false }) => {
  const handleSelect = (id: string) => setData(prev => ({ ...prev, selectedMetaphorId: id }));

  const toggleFormat = (key: FormatKey) =>
    setData(prev => ({
      ...prev,
      selectedFormats: { ...prev.selectedFormats, [key]: !prev.selectedFormats[key] },
    }));

  const count = Object.values(data.selectedFormats).filter(Boolean).length;
  const hasMotif = Boolean(data.selectedMetaphorId);

  // Der Knopf nennt die Menge, statt nur „generieren" zu sagen: wer „3 Bilder
  // erzeugen" liest, weiss vor dem Klick, was passiert — und was es kostet.
  const label = isDemoMode ? 'Demo-Bilder anzeigen' : count > 0 ? `${count} ${count === 1 ? 'Bild' : 'Bilder'} erzeugen` : 'Bilder erzeugen';
  const hint = isLoading
    ? 'Dauert meist eine halbe Minute, bei 4K länger.'
    : !hasMotif
      ? 'Wähle zuerst ein Motiv.'
      : count === 0
        ? 'Wähle mindestens ein Format.'
        : null;

  return (
    <div className="w-full max-w-6xl pb-8">
      <header className="svt-stagger mb-12 md:mb-16">
        <button
          type="button"
          onClick={onBack}
          className="svt-press t-rail -ml-1 inline-flex min-h-[44px] items-center gap-2 px-1 text-black/55 hover:text-black"
        >
          <ChevronLeft size={14} aria-hidden="true" /> Zurück zum Vers
        </button>
        {/* Leerzeichen vor <br />: sonst liest ein Screenreader „Wähleein". */}
        <h1 className="t-titel mt-4 text-[clamp(2.5rem,6.5vw,5rem)] text-black">
          Wähle{' '}
          <br />
          ein Motiv.
        </h1>
        <p className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-lg text-black/65">
          <span className="t-untertitel text-sm text-svt-green">{data.verse}</span>
          <span aria-hidden="true" className="text-black/25">·</span>
          <em>{data.theme}</em>
        </p>
      </header>

      <div className="svt-stagger space-y-12 md:space-y-16">
        {isDemoMode ? (
          <div className="border-l-2 border-svt-sand bg-svt-cream px-5 py-4 text-sm leading-relaxed text-svt-green">
            Vorschau-Modus: Formatwahl ist erlaubt, aber die Bilder kommen aus statischen Demo-Daten.
          </div>
        ) : null}

        <RailSection index={1} label="Motiv">
          <div className="grid gap-4 lg:grid-cols-3">
            {data.metaphors.map((m, i) => {
              const on = data.selectedMetaphorId === m.id;
              return (
                // Die Karte ist ein <article> mit einem echten <button> darin —
                // nicht selbst klickbar. Sonst waere das Aufklappen darunter ein
                // interaktives Element in einem interaktiven Element, und das
                // alte <div onClick> war per Tastatur gar nicht waehlbar.
                <article
                  key={m.id}
                  className={`relative flex flex-col border transition-colors duration-[240ms] ease-svt-out ${
                    on ? 'border-svt-green bg-svt-green text-svt-cream' : 'border-svt-green/20 bg-white/70 text-black hover:border-svt-green/45'
                  }`}
                >
                  {/* Bei Auswahl zieht sich oben eine Sandlinie — dieselbe Figur
                      wie in der Schrittanzeige, hier als Bestaetigung. */}
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[3px] overflow-hidden">
                    {on && <span key={`draw-${m.id}`} className="svt-draw block h-full w-full bg-svt-sand" />}
                  </span>

                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => handleSelect(m.id)}
                    className="flex flex-1 flex-col items-start p-6 text-left md:p-7"
                  >
                    <span className="flex w-full items-start justify-between">
                      <span className={`t-highlight text-5xl leading-none transition-colors duration-200 ${on ? 'text-svt-sand' : 'text-svt-green/30'}`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`mt-1 flex h-6 w-6 items-center justify-center border transition-colors duration-200 ${
                          on ? 'border-svt-sand bg-svt-sand text-svt-green' : 'border-black/20'
                        }`}
                      >
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                    </span>
                    <span className="t-untertitel mt-6 text-base leading-snug md:text-lg">{m.title}</span>{' '}
                    <span className={`mt-3 text-[15px] leading-relaxed ${on ? 'text-svt-cream/80' : 'text-black/65'}`}>{m.description}</span>
                  </button>

                  {/* Die englische Bildbeschreibung ist Werkzeug, nicht Inhalt —
                      zum Aufklappen, statt jede Karte damit zu fuellen. */}
                  <details className={`group/prompt border-t px-6 py-4 md:px-7 ${on ? 'border-svt-cream/15' : 'border-svt-green/15'}`}>
                    <summary
                      className={`t-rail flex min-h-[28px] cursor-pointer list-none items-center justify-between ${
                        on ? 'text-svt-cream/60 hover:text-svt-cream' : 'text-black/45 hover:text-black'
                      }`}
                    >
                      KI-Bildbeschreibung
                      <ChevronDown size={14} aria-hidden="true" className="transition-transform duration-200 ease-svt-out group-open/prompt:rotate-180" />
                    </summary>
                    <p className={`mt-3 font-mono text-[12px] leading-relaxed ${on ? 'text-svt-cream/70' : 'text-black/55'}`}>{m.visualPrompt}</p>
                  </details>
                </article>
              );
            })}
          </div>
        </RailSection>

        <RailSection index={2} label="Auflösung">
          <div role="group" aria-label="Auflösung" className="grid max-w-md grid-cols-3 gap-px border border-svt-green/25 bg-svt-green/25">
            {RESOLUTIONS.map(size => {
              const on = data.imageSize === size;
              return (
                <button
                  key={size}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setData(prev => ({ ...prev, imageSize: size }))}
                  className={`svt-press t-highlight min-h-[56px] text-[1.75rem] leading-none ${
                    on ? 'bg-svt-green text-svt-cream' : 'bg-svt-paper text-black hover:bg-white'
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[13px] text-black/55">Höhere Auflösung braucht länger.</p>
        </RailSection>

        <RailSection index={3} label="Formate">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {FIXED_FORMATS.map(f => {
              const on = data.selectedFormats[f.key];
              return (
                // Echte Checkbox, nur visuell versteckt: Leertaste schaltet,
                // Screenreader sagen „Kontrollkaestchen, aktiviert".
                <label
                  key={f.key}
                  className={`flex min-h-[116px] cursor-pointer flex-col justify-between border p-4 transition-colors duration-200 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-svt-green ${
                    on ? 'border-svt-green bg-svt-cream' : 'border-svt-green/20 bg-white/60 hover:border-svt-green/50'
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleFormat(f.key)} />
                  <span className="flex items-start justify-between">
                    <RatioGlyph ratio={f.ratio} on={on} />
                    <CheckMark on={on} />
                  </span>
                  <span className="mt-4">
                    <span className="t-untertitel block text-sm">{f.label}</span>{' '}
                    <span className="tabular block text-[12px] text-black/50">{f.ratio}</span>
                  </span>
                </label>
              );
            })}

            <div
              className={`flex min-h-[116px] flex-col justify-between border p-4 transition-colors duration-200 ${
                data.selectedFormats.custom ? 'border-svt-green bg-svt-cream' : 'border-svt-green/20 bg-white/60'
              }`}
            >
              <label className="flex cursor-pointer items-start justify-between focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-svt-green">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={data.selectedFormats.custom}
                  onChange={() => toggleFormat('custom')}
                />
                <RatioGlyph ratio={data.customRatio} on={data.selectedFormats.custom} />
                <CheckMark on={data.selectedFormats.custom} />
                <span className="sr-only">Eigenes Format</span>
              </label>
              <span className="mt-4">
                <span className="t-untertitel block text-sm">Eigenes</span>
                {/* 16 px auf dem Handy: darunter zoomt iOS beim Oeffnen. */}
                <select
                  aria-label="Seitenverhältnis für das eigene Format"
                  disabled={!data.selectedFormats.custom}
                  value={data.customRatio}
                  onChange={e => setData(prev => ({ ...prev, customRatio: e.target.value as AspectRatio }))}
                  className="mt-1 w-full cursor-pointer rounded-none border-0 border-b border-svt-green/30 bg-transparent py-1 text-base text-black outline-none focus:border-svt-green disabled:cursor-not-allowed disabled:opacity-45 md:text-[13px]"
                >
                  {CUSTOM_RATIOS.map(r => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          </div>
        </RailSection>

        <div className="border-t border-svt-green/15 pt-8 md:pt-10">
          <div className="md:ml-[calc(var(--rail)_+_2.5rem)]">
            <PrimaryAction
              label={label}
              loadingLabel="Bilder werden erzeugt …"
              state={isLoading ? 'loading' : hasMotif && count > 0 ? 'ready' : 'blocked'}
              onClick={onGenerate}
              hint={hint}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MetaphorSelection;
