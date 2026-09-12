import React, { useEffect, useRef, useState } from 'react';
import { MotionFormat, MotionPreset, MotionSettings } from '../types';
import { ChevronLeft, Download, ImagePlus, X } from 'lucide-react';
import ErrorDisplay, { AppError } from './ErrorDisplay';
import { RailSection } from './StepRail';
import { PrimaryAction } from './PrimaryAction';
import { CheckMark, RatioGlyph } from './Marks';
import {
  MotionRenderError,
  RenderedClip,
  RenderProgress,
  bannerCropLoss,
  isMotionSupported,
  loadImage,
  renderMotion,
} from '../services/motionRenderer';

interface MotionWorkspaceProps {
  /** Flyer als Data-URI. Kommt entweder aus dem vorigen Schritt oder aus dem Upload hier. */
  sourceImage: string | null;
  onBack: () => void;
  isDemoMode?: boolean;
}

const PRESETS: { key: MotionPreset; label: string; hint: string }[] = [
  { key: 'atem', label: 'Atem', hint: 'Sanftes Ein- und Ausatmen. Schließt exakt.' },
  { key: 'licht', label: 'Licht', hint: 'Ruhiges Auf- und Abschwellen. Schließt exakt.' },
  { key: 'pushin', label: 'Push-in', hint: 'Langsame Fahrt nach vorn, per Überblendung geschlossen.' },
  { key: 'staub', label: 'Staub', hint: 'Feine Partikel. Braucht etwa doppelt so lange.' },
];

const FORMATS: { key: MotionFormat; label: string; ratio: string; hint: string }[] = [
  { key: 'feed', label: 'Feed', ratio: '4:5', hint: 'Der Flyer wie er ist, kein Beschnitt.' },
  // Seit Commit ef888d3 fuellt der Renderer oben und unten mit einem Farbverlauf
  // aus den Randfarben des Flyers. Der alte Hinweis versprach noch die
  // unscharfe Bildkopie, die genau deshalb abgeschafft wurde (Geisterschrift).
  { key: 'story', label: 'Story', ratio: '9:16', hint: 'Flyer vollständig, oben und unten mit einem Verlauf aus seinen Randfarben aufgefüllt.' },
  // Keine feste Prozentzahl: die gilt nur für 4:5-Quellen. Den echten Wert
  // rechnet die Ausschnitts-Anzeige unten aus den Maßen des Flyers.
  { key: 'banner', label: 'TV-Loop', ratio: '16:9', hint: 'Beschnitt — ein Teil der Bildhöhe fällt weg.' },
];

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const MotionWorkspace: React.FC<MotionWorkspaceProps> = ({ sourceImage, onBack, isDemoMode = false }) => {
  const [image, setImage] = useState<string | null>(sourceImage);
  const [settings, setSettings] = useState<MotionSettings>({
    presets: ['atem', 'licht'],
    formats: ['feed', 'story'],
    duration: 8,
    bannerOffset: 0.5,
  });

  const [clips, setClips] = useState<RenderedClip[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  // Upload-Fehler getrennt vom Render-Fehler: er gehoert unter die Upload-
  // Flaeche, nicht ans Seitenende neben den Render-Knopf.
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [activeFormat, setActiveFormat] = useState<MotionFormat>('feed');
  const [cropLoss, setCropLoss] = useState<number | null>(null);
  // Wie im Bild-Schritt: volle Entwicklung fuer ein neues Ergebnis, die kurze
  // beim blossen Wechsel zwischen fertigen Clips.
  const [fullDevelop, setFullDevelop] = useState(true);

  const supported = isMotionSupported();
  const abortRef = useRef<AbortController | null>(null);

  // Beim Verlassen laufenden Render abbrechen und alle Objekt-URLs freigeben —
  // sonst haelt der Browser die Videos im Speicher, bis der Tab zugeht.
  const clipsRef = useRef<RenderedClip[]>([]);
  clipsRef.current = clips;
  useEffect(() => () => {
    abortRef.current?.abort();
    clipsRef.current.forEach(c => URL.revokeObjectURL(c.url));
  }, []);

  // Den echten 16:9-Verlust aus den Maßen der Quelle rechnen, statt die 45 %
  // als Text zu behaupten — bei einer anderen Quellhöhe stimmt die Zahl sonst
  // nicht.
  useEffect(() => {
    if (!image) { setCropLoss(null); return; }
    let alive = true;
    loadImage(image)
      .then(img => { if (alive) setCropLoss(bannerCropLoss(img.naturalWidth, img.naturalHeight)); })
      .catch(() => { if (alive) setCropLoss(null); });
    return () => { alive = false; };
  }, [image]);

  const togglePreset = (key: MotionPreset) => {
    setSettings(prev => {
      const next = prev.presets.includes(key)
        ? prev.presets.filter(p => p !== key)
        : [...prev.presets, key];
      // Ohne Preset gaebe es keine Bewegung — mindestens eines muss bleiben.
      return { ...prev, presets: next.length ? next : prev.presets };
    });
  };

  const toggleFormat = (key: MotionFormat) => {
    setSettings(prev => {
      const next = prev.formats.includes(key)
        ? prev.formats.filter(f => f !== key)
        : [...prev.formats, key];
      return { ...prev, formats: next.length ? next : prev.formats };
    });
  };

  const handleUpload = (file: File) => {
    setUploadError(null);
    if (!ACCEPTED.includes(file.type)) {
      setUploadError('Bitte JPG, PNG oder WebP verwenden.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError('Der Flyer ist zu groß. Bitte maximal 12 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      clips.forEach(c => URL.revokeObjectURL(c.url));
      setClips([]);
      setImage(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.onerror = () => setUploadError('Das Bild konnte nicht gelesen werden.');
    reader.readAsDataURL(file);
  };

  const handleRender = async () => {
    if (!image) return;
    setError(null);
    clips.forEach(c => URL.revokeObjectURL(c.url));
    setClips([]);
    setProgress(null);
    setIsRendering(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const rendered = await renderMotion(image, settings, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      setFullDevelop(true);
      setClips(rendered);
      if (rendered.length) setActiveFormat(rendered[0].format);
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setError({
          message: err instanceof MotionRenderError
            ? err.message
            : 'Beim Erzeugen des Videos ist ein Fehler aufgetreten.',
          errorType: 'UNKNOWN',
          retryable: true,
        });
      }
    } finally {
      abortRef.current = null;
      setIsRendering(false);
      setProgress(null);
    }
  };

  const active: RenderedClip | undefined =
    clips.find(c => c.format === activeFormat) || clips[0];

  const progressLabel = () => {
    if (!progress) return 'Wird vorbereitet …';
    const pct = Math.round((progress.frame / progress.frameCount) * 100);
    return `${progress.label} — ${progress.formatIndex + 1}/${progress.formatCount} · ${pct} %`;
  };

  // Gesamtfortschritt ueber alle Formate. Die Leiste lief vorher pro Format
  // von vorn los — bei zwei Formaten sah „fast fertig" zweimal gleich aus.
  const overallProgress = progress
    ? (progress.formatIndex + progress.frame / progress.frameCount) / progress.formatCount
    : null;

  const count = settings.formats.length;
  const renderState = isRendering ? 'loading' : image && supported && !isDemoMode ? 'ready' : 'blocked';
  const renderHint = isRendering
    ? 'Das Video entsteht auf deinem Gerät — Tab bitte offen lassen.'
    : isDemoMode
      ? 'In der Besucher-Vorschau wird nicht gerendert.'
      : !supported
        ? 'Dieser Browser kann keine Videos erzeugen.'
        : !image
          ? 'Zuerst einen Flyer hochladen.'
          : null;

  const uploadInput = (
    <input
      type="file"
      accept={ACCEPTED.join(',')}
      className="sr-only"
      onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
    />
  );

  return (
    <div className="w-full max-w-5xl pb-8">
      <header className="svt-stagger mb-12 md:mb-16">
        <button
          type="button"
          onClick={onBack}
          className="svt-press t-rail -ml-1 inline-flex min-h-[44px] items-center gap-2 px-1 text-black/55 hover:text-black"
        >
          <ChevronLeft size={14} aria-hidden="true" /> Zurück
        </button>
        <h1 className="t-titel mt-4 text-[clamp(2.5rem,6.5vw,5rem)] text-black">
          Flyer in{' '}
          <br />
          Bewegung.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-black/65">
          Kamera und Licht bewegen sich, die Pixel des Flyers bleiben unverändert — die Schrift kann deshalb nicht verzerren.
        </p>
      </header>

      <div className="svt-stagger space-y-12 md:space-y-16">
        {!supported && !isDemoMode ? (
          // Frueh sagen, nicht erst am Ende nach dem Einstellen.
          <div className="border-l-2 border-black bg-svt-cream px-5 py-4 text-sm leading-relaxed text-black/80">
            Dieser Browser kann keine Videos erzeugen. Das Rendern läuft direkt auf deinem Gerät und braucht Chrome, Edge oder Safari 17+.
          </div>
        ) : null}

        <RailSection index={1} label="Flyer">
          {!image ? (
            <label
              onDragOver={e => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={e => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleUpload(file);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed px-6 py-12 text-center transition-colors duration-200 focus-within:border-svt-green ${
                dragActive ? 'border-svt-green bg-svt-cream' : 'border-svt-sage hover:border-svt-green hover:bg-white/60'
              }`}
            >
              <ImagePlus size={22} className="text-svt-green" aria-hidden="true" />
              <span className="t-untertitel text-xs">{dragActive ? 'Loslassen zum Hochladen' : 'Flyer hochladen oder hierher ziehen'}</span>
              <span className="text-[12px] text-black/50">JPG, PNG oder WebP · bis 12 MB · bitte das Original, nicht die WhatsApp-Vorschau</span>
              {uploadInput}
            </label>
          ) : (
            <div className="flex flex-wrap items-start gap-5">
              <img src={image} alt="Ausgangsflyer" className="svt-develop w-36 border border-svt-green/20 md:w-44" />
              <div className="space-y-3">
                <p className="t-untertitel text-sm">Flyer geladen</p>
                <label className="svt-press t-rail inline-flex min-h-[44px] cursor-pointer items-center border border-black/25 px-4 hover:border-black focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-svt-green">
                  Anderer Flyer
                  {uploadInput}
                </label>
              </div>
            </div>
          )}
          {uploadError && (
            <p role="alert" className="mt-3 border-l-2 border-svt-sand bg-svt-cream px-4 py-3 text-[13px] text-black/75">
              {uploadError}
            </p>
          )}
        </RailSection>

        <RailSection index={2} label="Bewegung">
          <div className="grid gap-3 sm:grid-cols-2">
            {PRESETS.map(p => {
              const on = settings.presets.includes(p.key);
              return (
                <label
                  key={p.key}
                  className={`flex min-h-[88px] cursor-pointer items-start justify-between gap-4 border p-4 transition-colors duration-200 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-svt-green ${
                    on ? 'border-svt-green bg-svt-cream' : 'border-svt-green/20 bg-white/60 hover:border-svt-green/50'
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => togglePreset(p.key)} />
                  <span>
                    <span className="t-untertitel block text-sm">{p.label}</span>{' '}
                    <span className="mt-1 block text-[13px] leading-snug text-black/55">{p.hint}</span>
                  </span>
                  <CheckMark on={on} />
                </label>
              );
            })}
          </div>
          {/* Ohne diesen Satz wirkt ein Klick auf die letzte aktive Bewegung wie
              ein Fehler: er aendert nichts, weil eine immer bleiben muss. */}
          <p className="mt-3 text-[13px] text-black/55">Eine Bewegung bleibt immer an.</p>
        </RailSection>

        <RailSection index={3} label="Formate">
          <div className="grid grid-cols-3 gap-3">
            {FORMATS.map(f => {
              const on = settings.formats.includes(f.key);
              return (
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
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-black/55">
            {FORMATS.filter(f => settings.formats.includes(f.key)).map(f => `${f.label}: ${f.hint}`).join(' ')}
          </p>

          {/* 16:9-Ausschnitt. Bewusst vor dem Rendern sichtbar: aus 4:5 bleiben
              nur 45 % der Hoehe uebrig, und was oben und unten liegt, ist weg. */}
          {settings.formats.includes('banner') && (
            <div className="svt-rise mt-6 border-l-2 border-svt-sand bg-svt-cream px-5 py-5">
              <p className="t-rail text-svt-green">16:9 schneidet ab</p>
              <p className="mt-1.5 text-[14px] text-black/70">
                {cropLoss !== null
                  ? `Von diesem Flyer bleiben nur ${Math.round((1 - cropLoss) * 100)} % der Bildhöhe. Wähle, welcher Teil bleibt.`
                  : 'Ein Teil der Bildhöhe fällt weg. Wähle, welcher Teil bleibt.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-6">
                <div className="flex min-w-[220px] flex-1 items-center gap-3">
                  <span className="t-rail text-black/60">Oben</span>
                  <label htmlFor="banner-offset" className="sr-only">Lage des 16:9-Ausschnitts</label>
                  <input
                    id="banner-offset"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.bannerOffset}
                    onChange={e => setSettings(p => ({ ...p, bannerOffset: Number(e.target.value) }))}
                    className="flex-1 accent-svt-green"
                  />
                  <span className="t-rail text-black/60">Unten</span>
                </div>
                {image && cropLoss !== null && (
                  // Folgt dem Regler ohne Uebergang: Direkte Manipulation muss
                  // dem Finger 1:1 folgen, jede Verzoegerung wirkt schwammig.
                  <div className="relative inline-block">
                    <img src={image} alt="" className="w-28 opacity-40" />
                    <div
                      className="absolute left-0 w-full border-y-2 border-svt-green bg-svt-green/10"
                      style={{
                        height: `${(1 - cropLoss) * 100}%`,
                        top: `${settings.bannerOffset * cropLoss * 100}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </RailSection>

        <div className="border-t border-svt-green/15 pt-8 md:pt-10">
          <div className="md:ml-[calc(var(--rail)_+_2.5rem)]">
            {/* Kein eigener „Erneut versuchen"-Knopf: der Hauptknopf steht direkt
                darunter, und bei deterministischen Fehlern (Flyer zu klein)
                zeigt Wiederholen ohnehin nur denselben Fehler. */}
            {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}
            <PrimaryAction
              label={`${count} ${count === 1 ? 'Video' : 'Videos'} erzeugen`}
              loadingLabel="Video wird gerendert …"
              progressText={isRendering ? progressLabel() : null}
              progress={isRendering ? overallProgress : null}
              state={renderState}
              onClick={handleRender}
              hint={renderHint}
            />
            {isRendering && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="svt-press t-rail mt-3 inline-flex min-h-[44px] items-center gap-2 border border-black/25 px-4 text-black hover:border-black"
              >
                <X size={12} aria-hidden="true" /> Abbrechen
              </button>
            )}
          </div>
        </div>

        {clips.length > 0 && active && (
          // Dieselbe Buehne wie im Bild-Schritt: das Ergebnis ist der Hoehepunkt.
          <section aria-label="Ergebnis" className="svt-deep svt-rise overflow-hidden">
            <div role="group" aria-label="Format" className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-3 py-3 md:px-5">
              {clips.map(r => {
                const on = active.format === r.format;
                return (
                  <button
                    key={r.format}
                    type="button"
                    aria-pressed={on}
                    onClick={() => { setFullDevelop(false); setActiveFormat(r.format); }}
                    className={`svt-press t-rail flex min-h-[40px] shrink-0 items-center px-3 ${
                      on ? 'bg-svt-cream text-svt-green' : 'text-svt-cream/60 hover:text-svt-cream'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            <div className="flex justify-center p-5 md:p-10">
              {/* muted + playsInline sind auf iOS Pflicht, sonst startet das
                  Video nicht von selbst und springt in den Vollbildmodus. */}
              <video
                key={active.url}
                src={active.url}
                className={`${fullDevelop ? 'svt-develop' : 'svt-develop-fast'} max-h-[70vh] max-w-full bg-black outline outline-1 outline-white/15`}
                autoPlay
                loop
                muted
                playsInline
                controls
              />
            </div>

            <div className="flex flex-col gap-4 border-t border-white/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between md:px-8">
              <p className="tabular text-[13px] text-svt-cream/70">
                {active.width}×{active.height} · {active.duration} s ·{' '}
                {(active.blob.size / 1024 / 1024).toFixed(1)} MB · in {active.seconds} s gerendert
              </p>
              {/* Das Video liegt als Blob im Browser. `download` mit explizitem
                  Dateinamen ist auf iPhone/iPad Pflicht — ohne Endung landet die
                  Datei ohne Typ im Downloads-Ordner und laesst sich nicht oeffnen
                  (dieselbe Falle wie bei den Bild-Downloads, PR #2/#3). */}
              <a
                href={active.url}
                download={`tyrannus-${active.format}.mp4`}
                className="svt-press group t-rail inline-flex min-h-[44px] items-center gap-2 bg-svt-cream px-5 text-svt-green hover:bg-white"
              >
                <Download size={13} aria-hidden="true" className="transition-transform duration-200 ease-svt-out group-hover:translate-y-0.5" />
                Herunterladen
              </a>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default MotionWorkspace;
