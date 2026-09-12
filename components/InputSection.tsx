import React, { useRef, useState } from 'react';
import { AppData } from '../types';
import { ImagePlus, X } from 'lucide-react';
import { RailSection } from './StepRail';
import { PrimaryAction } from './PrimaryAction';

interface InputSectionProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  onNext: () => void;
  isLoading: boolean;
  isDemoMode?: boolean;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const STYLE_OPTIONS: { key: AppData['styleMode']; label: string; sub: string }[] = [
  { key: 'classic', label: 'Klassisch', sub: 'Zeitlos' },
  { key: 'modern', label: 'Modern', sub: 'Editorial' },
];

interface LineFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

/**
 * Grosses Eingabefeld auf einer Haarlinie. Beim Fokus zieht sich darunter eine
 * gruene Linie von links — dieselbe Figur wie in der Schrittanzeige. Sie ist
 * zugleich der Fokusindikator (2 px, volle Breite, kontraststark); der
 * Standard-Umriss faellt deshalb hier weg, statt doppelt zu zeichnen.
 *
 * 24 px Schrift auch auf dem Handy: unter 16 px zoomt iOS beim Fokussieren.
 */
const LineField: React.FC<LineFieldProps> = ({ id, label, value, placeholder, onChange }) => (
  <div className="group relative">
    <label htmlFor={id} className="t-rail text-black/55">
      {label}
    </label>
    <input
      id={id}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      aria-required="true"
      className="mt-3 w-full rounded-none border-b border-svt-green/40 bg-transparent pb-3 text-2xl font-light text-black outline-none placeholder:text-black/25 focus-visible:outline-none md:text-[1.75rem]"
    />
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 bg-svt-green transition-transform duration-300 ease-svt-out group-focus-within:scale-x-100"
    />
  </div>
);

const InputSection: React.FC<InputSectionProps> = ({ data, setData, onNext, isLoading, isDemoMode = false }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Nur-Leerzeichen zaehlt nicht: sonst loest ein versehentliches Leerzeichen
  // einen kostenpflichtigen Aufruf mit leerem Vers aus.
  const canSubmit = Boolean(data.verse.trim() && data.theme.trim());

  const loadFile = (file: File, resetInput?: () => void) => {
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError('Bitte JPG, PNG oder WebP verwenden.');
      resetInput?.();
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError('Das Bild ist zu groß. Bitte maximal 5 MB hochladen.');
      resetInput?.();
      return;
    }

    setUploadError(null);
    const reader = new FileReader();
    reader.onloadend = () => {
      setData(prev => ({ ...prev, referenceImage: reader.result as string }));
    };
    reader.onerror = () => {
      setUploadError('Das Bild konnte nicht gelesen werden.');
      resetInput?.();
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file, () => { e.target.value = ''; });
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const handleRemoveImage = () => {
    setData(prev => ({ ...prev, referenceImage: null }));
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-full max-w-5xl pb-8">
      {/* Oeffner nach dem Muster der Guideline: sehr grosser, zweizeiliger
          Titel, buendig links. Die Vision steht darunter so, wie die Marke sie
          selbst setzt — mit kursiver Betonung auf dem Verb. */}
      <header className="svt-stagger mb-14 md:mb-20">
        <p className="t-rail text-svt-green">Bildstudio · Schule von Tyrannus</p>
        {/* Das explizite Leerzeichen vor <br /> ist Absicht: ohne es liest ein
            Screenreader „Verszum" — JSX verschluckt den Umbruch zwischen Text
            und Element, und <br /> selbst traegt keinen Wortabstand. */}
        <h1 className="t-titel mt-6 text-[clamp(2.9rem,8.5vw,6.75rem)] text-black">
          Vom Vers{' '}
          <br />
          zum Bild.
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-black/65 md:text-xl">
          Gott <em>begegnen</em>. Jesus <em>lieben</em>. Erweckung <em>leben</em>.
        </p>
      </header>

      <div className="svt-stagger space-y-12 md:space-y-16">
        {isDemoMode ? (
          <div className="border-l-2 border-svt-sand bg-svt-cream px-5 py-4 text-sm leading-relaxed text-svt-green">
            Vorschau-Modus: Eingaben bleiben lokal. Der Button zeigt vorbereitete Beispielmotive und löst keine KI-Anfrage aus.
          </div>
        ) : null}

        <RailSection index={1} label="Vers">
          <div className="grid gap-10 md:grid-cols-2 md:gap-8">
            <LineField
              id="verse"
              label="Bibelstelle"
              value={data.verse}
              placeholder="Römer 12,2"
              onChange={verse => setData(prev => ({ ...prev, verse }))}
            />
            <LineField
              id="theme"
              label="Thema"
              value={data.theme}
              placeholder="Erneuerung des Sinnes"
              onChange={theme => setData(prev => ({ ...prev, theme }))}
            />
          </div>
        </RailSection>

        <RailSection index={2} label="Bildidee">
          <label htmlFor="vision" className="t-rail text-black/55">
            Konkrete Elemente <span className="font-normal normal-case tracking-normal text-black/40">— optional</span>
          </label>
          <textarea
            id="vision"
            value={data.userVision}
            onChange={e => setData(prev => ({ ...prev, userVision: e.target.value }))}
            rows={4}
            placeholder="Ein alter Olivenbaum im Sturm. Goldene Risse im Beton. Moderne Architektur bei Nacht."
            className="mt-3 w-full resize-none rounded-none border border-svt-green/20 bg-white/70 p-4 text-lg font-light leading-relaxed text-black outline-none transition-colors duration-200 placeholder:text-black/30 focus:border-svt-green md:p-5"
          />
        </RailSection>

        <RailSection index={3} label="Stil">
          {/* Zwei Knoepfe mit `aria-pressed` statt Radio-Rolle: dafuer braucht
              es keine Pfeiltasten-Steuerung, und es bleibt korrekt. Die
              Haarlinien zwischen den Feldern entstehen aus `gap-px` auf
              gruenem Grund — keine zusaetzlichen Rahmen noetig. */}
          <div role="group" aria-label="Stilrichtung" className="grid grid-cols-2 gap-px border border-svt-green/25 bg-svt-green/25">
            {STYLE_OPTIONS.map(opt => {
              const on = data.styleMode === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setData(prev => ({ ...prev, styleMode: opt.key }))}
                  className={`svt-press flex min-h-[68px] flex-col items-start justify-center px-5 py-4 text-left ${
                    on ? 'bg-svt-green text-svt-cream' : 'bg-svt-paper text-black hover:bg-white'
                  }`}
                >
                  <span className="t-untertitel text-sm">{opt.label}</span>{' '}
                  <span className={`mt-1 text-[12px] ${on ? 'text-svt-cream/70' : 'text-black/50'}`}>{opt.sub}</span>
                </button>
              );
            })}
          </div>
        </RailSection>

        <RailSection index={4} label="Referenz">
          <p className="t-rail mb-3 text-black/55">
            Referenzbild <span className="font-normal normal-case tracking-normal text-black/40">— optional</span>
          </p>

          {!data.referenceImage ? (
            // Ein echtes <label> statt <div onClick>: per Tastatur erreichbar,
            // oeffnet den Dateidialog von selbst und traegt den Fokusrahmen.
            <label
              htmlFor="reference-upload"
              onDragOver={e => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed px-6 py-10 text-center transition-colors duration-200 focus-within:border-svt-green ${
                dragActive ? 'border-svt-green bg-svt-cream' : 'border-svt-sage hover:border-svt-green hover:bg-white/60'
              }`}
            >
              <ImagePlus size={22} className="text-svt-green" aria-hidden="true" />
              <span className="t-untertitel text-xs">
                {dragActive ? 'Loslassen zum Hochladen' : 'Bild hochladen oder hierher ziehen'}
              </span>
              <span className="text-[12px] text-black/50">JPG, PNG oder WebP · bis 5 MB</span>
              <input
                id="reference-upload"
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          ) : (
            <figure className="svt-develop relative overflow-hidden border border-svt-green/20">
              <img src={data.referenceImage} alt="Hochgeladenes Referenzbild" className="aspect-video w-full object-cover" />
              <figcaption className="t-rail absolute bottom-0 left-0 bg-svt-green px-3 py-2 text-svt-cream">
                Referenz aktiv
              </figcaption>
              {/* Immer sichtbar, nicht erst bei Hover — auf dem Handy gibt es
                  kein Hover, und der Knopf waere dort unauffindbar. 44 px. */}
              <button
                type="button"
                onClick={handleRemoveImage}
                aria-label="Referenzbild entfernen"
                className="svt-press absolute right-3 top-3 flex h-11 w-11 items-center justify-center border border-svt-green/20 bg-white/90 text-black hover:bg-white"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </figure>
          )}

          {uploadError && (
            <p role="alert" className="mt-3 border-l-2 border-svt-sand bg-svt-cream px-4 py-3 text-[13px] text-black/75">
              {uploadError}
            </p>
          )}
        </RailSection>

        <div className="border-t border-svt-green/15 pt-8 md:pt-10">
          {/* Buendig mit der Inhaltsspalte, nicht mit der Label-Spalte. */}
          <div className="md:ml-[calc(var(--rail)_+_2.5rem)]">
            <PrimaryAction
              label={isDemoMode ? 'Beispielmotive anzeigen' : 'Motive entwickeln'}
              loadingLabel="Motive werden entwickelt …"
              state={isLoading ? 'loading' : canSubmit ? 'ready' : 'blocked'}
              onClick={onNext}
              hint={!canSubmit && !isLoading ? 'Bibelstelle und Thema eintragen — dann geht es weiter.' : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default InputSection;
