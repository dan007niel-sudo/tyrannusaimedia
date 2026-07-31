import React, { useEffect, useRef, useState } from 'react';
import { MotionFormat, MotionJob, MotionPreset, MotionResult, MotionSettings } from '../types';
import { ChevronLeft, Download, Film, Loader2, Upload } from 'lucide-react';
import { createMotionJob, extractAppError, waitForMotionJob } from '../services/geminiService';
import ErrorDisplay, { AppError } from './ErrorDisplay';

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

const FORMATS: { key: MotionFormat; label: string; hint: string }[] = [
  { key: 'feed', label: 'Feed 4:5', hint: 'Der Flyer wie er ist, kein Beschnitt.' },
  { key: 'story', label: 'Story 9:16', hint: 'Flyer vollständig, oben und unten unscharf aufgefüllt.' },
  { key: 'banner', label: 'TV-Loop 16:9', hint: 'Beschnitt — es bleiben nur 45 % der Bildhöhe.' },
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

  const [job, setJob] = useState<MotionJob | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [activeFormat, setActiveFormat] = useState<MotionFormat>('feed');

  // Beim Verlassen der Komponente muss das Pollen aufhoeren, sonst laeuft es
  // im Hintergrund weiter und schreibt in einen abgeraeumten State.
  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

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
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError({ message: 'Bitte JPG, PNG oder WebP verwenden.', errorType: 'UNKNOWN', retryable: false });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError({ message: 'Der Flyer ist zu groß. Bitte maximal 12 MB.', errorType: 'UNKNOWN', retryable: false });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(typeof reader.result === 'string' ? reader.result : null);
      setJob(null);
    };
    reader.readAsDataURL(file);
  };

  const handleRender = async () => {
    if (!image) return;
    setError(null);
    setIsRendering(true);
    setJob(null);
    cancelledRef.current = false;

    try {
      const created = await createMotionJob(image, settings, isDemoMode);
      setJob(created);
      const finished = await waitForMotionJob(
        created.jobId,
        update => { if (!cancelledRef.current) setJob(update); },
        () => cancelledRef.current,
      );
      if (!cancelledRef.current) {
        setJob(finished);
        if (finished.results.length) setActiveFormat(finished.results[0].format);
      }
    } catch (err: any) {
      if (!cancelledRef.current) setError(extractAppError(err));
    } finally {
      if (!cancelledRef.current) setIsRendering(false);
    }
  };

  const active: MotionResult | undefined = job?.results.find(r => r.format === activeFormat)
    || job?.results[0];

  const progressLabel = () => {
    if (!job) return 'Job wird angelegt…';
    if (job.status === 'queued') return 'In der Warteschlange…';
    const { done, total, current } = job.progress;
    return current ? `${current} — Format ${done + 1} von ${total}` : `${done} von ${total} fertig`;
  };

  return (
    <div className="w-full max-w-5xl animate-fade-in">
      <button
        onClick={onBack}
        className="mb-6 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-black"
      >
        <ChevronLeft size={14} /> Zurück
      </button>

      <div className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1F3A2E]">Bewegtbild</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">Flyer in Bewegung bringen</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600">
          Kamera und Licht bewegen sich, die Pixel des Flyers bleiben unverändert.
          Die Schrift kann deshalb nicht verzerren.
        </p>
      </div>

      {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}

      {/* Quelle */}
      {!image ? (
        <label className="mb-8 flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed border-black/20 bg-white/60 px-6 py-14 transition-colors hover:border-black/50 focus-within:border-[#1F3A2E] focus-within:ring-2 focus-within:ring-[#1F3A2E]">
          <Upload size={20} className="text-[#1F3A2E]" />
          <span className="text-xs font-bold uppercase tracking-widest">Flyer hochladen</span>
          <span className="text-[11px] text-zinc-500">JPG, PNG, WebP bis 12 MB</span>
          <input
            type="file"
            accept={ACCEPTED.join(',')}
            className="sr-only"
            onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
          />
        </label>
      ) : (
        <div className="mb-8 flex flex-wrap items-start gap-6">
          <img src={image} alt="Ausgangsflyer" className="w-40 border border-black/10" />
          <label className="cursor-pointer border border-black/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors hover:border-black focus-within:border-[#1F3A2E] focus-within:ring-2 focus-within:ring-[#1F3A2E]">
            Anderer Flyer
            <input
              type="file"
              accept={ACCEPTED.join(',')}
              className="sr-only"
              onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {/* Einstellungen */}
      <div className="mb-8 grid gap-8 md:grid-cols-2">
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Bewegung</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => {
              const on = settings.presets.includes(p.key);
              return (
                <button
                  key={p.key}
                  onClick={() => togglePreset(p.key)}
                  // Der Zustand darf nicht nur an der Hintergrundfarbe haengen.
                  aria-pressed={on}
                  className={`border px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                    on ? 'border-[#1F3A2E] bg-[#1F3A2E] text-white' : 'border-black/20 bg-white/60 hover:border-black'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            {PRESETS.filter(p => settings.presets.includes(p.key)).map(p => p.hint).join(' ')}
          </p>
        </div>

        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Formate</p>
          <div className="flex flex-col gap-2">
            {FORMATS.map(f => {
              const on = settings.formats.includes(f.key);
              return (
                <label key={f.key} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleFormat(f.key)}
                    className="mt-0.5 accent-[#1F3A2E]"
                  />
                  <span>
                    <span className="text-[11px] font-bold uppercase tracking-widest">{f.label}</span>
                    <span className="block text-[11px] text-zinc-500">{f.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* 16:9-Ausschnitt. Bewusst vor dem Rendern sichtbar: aus 4:5 bleiben nur
          45 % der Hoehe uebrig, und was oben und unten liegt, ist weg. */}
      {settings.formats.includes('banner') && (
        <div className="mb-8 border border-[#D6C3A3] bg-[#D6C3A3]/15 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#1F3A2E]">
            16:9 schneidet ab
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Aus einem 4:5-Flyer bleiben nur 45 % der Bildhöhe. Wähle, welcher Teil bleibt.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Oben</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.bannerOffset}
              onChange={e => setSettings(p => ({ ...p, bannerOffset: Number(e.target.value) }))}
              className="flex-1 accent-[#1F3A2E]"
            />
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Unten</span>
          </div>
          {image && (
            <div className="relative mt-3 inline-block">
              <img src={image} alt="" className="w-32 opacity-40" />
              <div
                className="absolute left-0 w-full border-y-2 border-[#1F3A2E] bg-[#1F3A2E]/10"
                style={{ height: '45%', top: `${settings.bannerOffset * 55}%` }}
              />
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleRender}
        disabled={!image || isRendering || isDemoMode}
        className="mb-8 flex w-full items-center justify-center gap-2 bg-[#1F3A2E] px-6 py-4 text-xs font-bold uppercase tracking-widest text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 md:w-auto"
      >
        {isRendering ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
        {isRendering ? progressLabel() : 'Bewegtbild erzeugen'}
      </button>

      {isDemoMode && (
        <p className="mb-8 text-[11px] text-zinc-500">
          In der Besucher-Vorschau wird nicht gerendert.
        </p>
      )}

      {/* Ergebnis */}
      {job?.status === 'done' && job.results.length > 0 && (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {job.results.map(r => (
              <button
                key={r.format}
                onClick={() => setActiveFormat(r.format)}
                className={`border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  active?.format === r.format
                    ? 'border-[#1F3A2E] bg-[#1F3A2E] text-white'
                    : 'border-black/20 bg-white/60 hover:border-black'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {active && (
            <div className="flex flex-col items-start gap-4">
              {/* muted + playsInline sind auf iOS Pflicht, sonst startet das
                  Video nicht von selbst und springt in den Vollbildmodus. */}
              <video
                key={active.url}
                src={active.url}
                className="max-h-[70vh] border border-black/10 bg-black"
                autoPlay
                loop
                muted
                playsInline
                controls
              />
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href={`${active.url}&download=1`}
                  className="flex items-center gap-2 border border-black px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors hover:bg-black hover:text-white"
                >
                  <Download size={12} /> Herunterladen
                </a>
                <span className="text-[11px] text-zinc-500">
                  {active.width}×{active.height} · {active.duration}s · in {active.seconds}s gerendert
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MotionWorkspace;
