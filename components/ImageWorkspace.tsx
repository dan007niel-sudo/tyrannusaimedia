import React, { useEffect, useState } from 'react';
import { AppData } from '../types';
import { AlertCircle, ChevronLeft, Download, Layout, Monitor, Smartphone, Square } from 'lucide-react';
import { editImage, extractAppError } from '../services/geminiService';
import ErrorDisplay, { AppError } from './ErrorDisplay';

interface ImageWorkspaceProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  onBack: () => void;
  isDemoMode?: boolean;
}

function dataUriToBlob(dataUri: string): Blob {
  const separator = dataUri.indexOf(',');
  if (separator < 0) throw new Error('Ungültige Bilddaten.');

  const header = dataUri.slice(0, separator);
  const payload = dataUri.slice(separator + 1);
  const mimeType = header.match(/^data:([^;,]+)/)?.[1] || 'image/png';

  if (header.includes(';base64')) {
    const binary = window.atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

/**
 * Ein Bild fuer alle drei Download-Wege — Link, Formular, Knopf. Welcher Weg
 * greift, entscheidet die Herkunft des Bildes (gespeicherte URL, eingebettete
 * Daten, Vorschau); siehe PR #2/#3. Fuer den Nutzer muss es derselbe Knopf sein.
 */
const DOWNLOAD_CLASS =
  'svt-press group flex w-full items-center justify-between border border-svt-green bg-svt-green px-6 py-5 text-svt-cream hover:border-black hover:bg-black md:px-7';

const RailLabel: React.FC<{ index: number; children: React.ReactNode }> = ({ index, children }) => (
  <p className="t-rail flex items-center gap-3 text-svt-green">
    <span className="tabular shrink-0">{String(index).padStart(2, '0')}</span>
    <span className="block h-px w-6 shrink-0 bg-current" aria-hidden="true" />
    <span>{children}</span>
  </p>
);

const ImageWorkspace: React.FC<ImageWorkspaceProps> = ({ data, setData, onBack, isDemoMode = false }) => {
  // Determine initial view based on what's available
  const availableKeys = Object.keys(data.generatedImages).filter(k => data.generatedImages[k] !== null);
  const [activeKey, setActiveKey] = useState<string>(availableKeys[0] || 'feed');

  const editPrompt = data.editPrompts?.[activeKey] ?? '';
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<AppError | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Voller Entwicklungseffekt beim ersten Erscheinen und nach einer
  // Bearbeitung — dann ist wirklich ein neues Bild entstanden. Beim blossen
  // Formatwechsel die kurze Fassung: wer zwischen Feed und Story hin- und
  // herschaltet, soll nicht jedes Mal eine halbe Sekunde warten.
  const [fullDevelop, setFullDevelop] = useState(true);

  const currentImage = data.generatedImages[activeKey];
  const currentGenerationError = data.generatedImageErrors[activeKey];
  const failedKeys = Object.keys(data.generatedImageErrors || {});

  useEffect(() => {
    if (!availableKeys.includes(activeKey)) {
      setActiveKey(availableKeys[0] || 'feed');
    }
  }, [availableKeys.join('|'), activeKey]);

  const getDownloadFilename = (mimeType = 'image/png') => {
    const extension = mimeType === 'image/jpeg'
      ? 'jpg'
      : mimeType === 'image/webp'
        ? 'webp'
        : mimeType === 'image/svg+xml'
          ? 'svg'
          : 'png';
    return `tyrannus-media-${activeKey}-${Date.now()}.${extension}`;
  };

  const currentDownloadHref = currentImage?.startsWith('https://')
    ? `/api/download-image?${new URLSearchParams({
        url: currentImage,
        filename: getDownloadFilename(),
      }).toString()}`
    : null;

  const handleEmbeddedImageDownload = async () => {
    if (!currentImage) return;
    setDownloadError(null);

    try {
      const blob = dataUriToBlob(currentImage);
      const file = new File([blob], getDownloadFilename(blob.type), { type: blob.type });
      const canShareFile = typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function'
        && navigator.maxTouchPoints > 0
        && navigator.canShare({ files: [file] });

      if (canShareFile) {
        try {
          await navigator.share({
            files: [file],
            title: 'Tyrannus Media Bild',
          });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      setDownloadError('Das Bild konnte nicht gespeichert werden. Bitte versuche es erneut.');
    }
  };

  const handleEdit = async () => {
    if (isDemoMode) {
      setEditError({
        message: 'Bearbeitung ist im Vorschau-Modus deaktiviert. Es wird keine KI-Anfrage ausgelöst.',
        errorType: 'UNKNOWN',
        retryable: false,
      });
      return;
    }
    if (!editPrompt || !currentImage) return;
    setIsEditing(true);
    setEditError(null);
    try {
      const newImage = await editImage(currentImage, editPrompt);

      setData(prev => ({
          ...prev,
          generatedImages: {
              ...prev.generatedImages,
              [activeKey]: newImage
          }
      }));
      setFullDevelop(true);
      setData(prev => ({
        ...prev,
        editPrompts: { ...(prev.editPrompts || {}), [activeKey]: '' },
      }));
      setDownloadError(null);
    } catch (err) {
      setEditError(extractAppError(err));
    } finally {
      setIsEditing(false);
    }
  };

  const selectFormat = (key: string) => {
    setFullDevelop(false);
    setActiveKey(key);
  };

  const getLabel = (key: string) => {
      switch(key) {
          case 'feed': return { text: 'Feed (4:5)', short: 'Feed', icon: <Layout size={13} aria-hidden="true" /> };
          case 'story': return { text: 'Story (9:16)', short: 'Story', icon: <Smartphone size={13} aria-hidden="true" /> };
          case 'banner': return { text: 'Banner (16:9)', short: 'Banner', icon: <Monitor size={13} aria-hidden="true" /> };
          default: return { text: `Eigenes (${data.customRatio})`, short: 'Eigenes', icon: <Square size={13} aria-hidden="true" /> };
      }
  };

  const activeLabel = getLabel(activeKey).text;
  const canEdit = !isDemoMode && Boolean(editPrompt.trim()) && Boolean(currentImage) && !isEditing;

  // Kurzer Schluessel statt der Bilddaten selbst: eine Data-URI ist mehrere MB
  // lang, und React vergleicht Schluessel bei jedem Rendern. Das Ende der
  // Base64-Kette unterscheidet sich zwischen zwei Bildern praktisch immer.
  const imageKey = currentImage ? `${activeKey}-${currentImage.length}-${currentImage.slice(-24)}` : activeKey;

  return (
    <div className="w-full max-w-[1400px] pb-4">
      {/* Kopf wie auf den anderen Screens. Der Zurueck-Knopf sitzt hier und
          nicht mehr absolut ueber der Bildflaeche — dort hat er den
          Vorschau-Hinweis ueberdeckt. */}
      <header className="svt-stagger mb-8 md:mb-10">
        <button
          type="button"
          onClick={onBack}
          className="svt-press t-rail -ml-1 inline-flex min-h-[44px] items-center gap-2 px-1 text-black/55 hover:text-black"
        >
          <ChevronLeft size={14} aria-hidden="true" /> Zurück zur Motivwahl
        </button>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <h1 className="t-titel text-[clamp(2.25rem,5vw,3.75rem)] text-black">Dein Bild.</h1>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1 text-lg text-black/65">
            <span className="t-untertitel text-sm text-svt-green">{data.verse}</span>
            <span aria-hidden="true" className="text-black/25">·</span>
            <em>{data.theme}</em>
          </p>
        </div>
      </header>

      {(failedKeys.length > 0 || isDemoMode) && (
        <div className="svt-rise mb-6 space-y-3">
          {failedKeys.length > 0 && (
            <div role="status" className="border-l-2 border-black bg-svt-cream px-5 py-4">
              <p className="t-rail flex items-center gap-2 text-black">
                <AlertCircle size={13} aria-hidden="true" /> Teilweise erzeugt
              </p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-black/75">
                {failedKeys.map(key => getLabel(key).text).join(', ')} konnte nicht erzeugt werden. Die erfolgreichen Formate bleiben verfügbar.
              </p>
              <ul className="mt-3 space-y-2 border-t border-black/10 pt-3 text-[13px] leading-relaxed text-black/75">
                {failedKeys.map(key => {
                  const failure = data.generatedImageErrors[key];
                  return (
                    <li key={key}>
                      <strong>{getLabel(key).text}:</strong> {failure.message}
                      {failure.errorType === 'BILLING_REQUIRED' ? ' Es erfolgt kein automatischer erneuter Versuch.' : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {isDemoMode && (
            <div className="border-l-2 border-svt-sand bg-svt-cream px-5 py-4 text-sm leading-relaxed text-svt-green">
              Vorschau-Modus: Diese Bilder sind statische Platzhalter. Bearbeitung, Speicherung und KI-Generierung sind deaktiviert.
            </div>
          )}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-10">
        {/* Die Buehne. Das eine Mal, an dem die App die volle dunkle Flaeche
            nutzt — die Guideline setzt sie fuer ihre Hoehepunkte ein, und hier
            ist der Hoehepunkt: das fertige Bild. */}
        <section aria-label="Vorschau" className="svt-deep svt-rise relative flex min-h-[62vh] flex-col overflow-hidden">
          <div className="relative border-b border-white/10">
            <div role="group" aria-label="Format" className="flex items-center gap-1 overflow-x-auto px-3 py-3 md:px-5">
              {availableKeys.map(key => {
                const label = getLabel(key);
                const on = activeKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => selectFormat(key)}
                    className={`svt-press t-rail flex min-h-[40px] shrink-0 items-center gap-2 px-3 ${
                      on ? 'bg-svt-cream text-svt-green' : 'text-svt-cream/60 hover:text-svt-cream'
                    }`}
                  >
                    {label.icon}
                    {/* Auf dem Handy nur der Name: mit Seitenverhaeltnis war der
                        dritte Knopf bei 375 px abgeschnitten („BANNE…"). */}
                    <span className="sm:hidden">{label.short}</span>
                    <span className="hidden sm:inline">{label.text}</span>
                  </button>
                );
              })}
            </div>
            {isEditing && <span aria-hidden="true" className="svt-sweep absolute -bottom-px left-0 h-[2px] w-1/3 bg-svt-sand" />}
          </div>

          <div className="relative flex flex-1 items-center justify-center p-5 md:p-10">
            {currentImage ? (
              // Die Signatur der App: Das Bild kommt hoch wie ein Abzug, der sich
              // entwickelt. Kein Schatten — die Marke kennt keine; eine feine
              // helle Kante trennt es von der Flaeche.
              <img
                key={imageKey}
                src={currentImage}
                alt={`Erzeugtes Motiv, Format ${activeLabel}`}
                className={`${fullDevelop ? 'svt-develop' : 'svt-develop-fast'} max-h-[min(72vh,900px)] w-auto max-w-full object-contain outline outline-1 outline-white/15 transition-opacity duration-300 ${
                  isEditing ? 'opacity-50' : ''
                }`}
              />
            ) : (
              <div className="max-w-sm text-center text-svt-cream">
                <AlertCircle size={20} aria-hidden="true" className="mx-auto text-svt-sand" />
                <p className="t-rail mt-3">Format nicht verfügbar</p>
                <p className="mt-2 text-[15px] leading-relaxed text-svt-cream/75">
                  {currentGenerationError?.message || 'Für dieses Format ist noch kein Entwurf entstanden.'}
                </p>
              </div>
            )}
            {isEditing && (
              <p aria-live="polite" className="t-rail absolute bottom-4 left-1/2 -translate-x-1/2 bg-svt-green px-3 py-2 text-svt-cream">
                Wird überarbeitet …
              </p>
            )}
          </div>
        </section>

        <aside className="svt-rise space-y-10 lg:sticky lg:top-28">
          <div className="space-y-4">
            <RailLabel index={1}>Verfeinern</RailLabel>
            <p className="text-[13px] text-black/55">
              Gilt für <span className="t-untertitel text-[12px] text-black">{activeLabel}</span>.
            </p>
            <label htmlFor="edit-prompt" className="sr-only">
              Gewünschte Änderung
            </label>
            <textarea
              id="edit-prompt"
              value={editPrompt}
              onChange={(e) => setData(prev => ({
                ...prev,
                editPrompts: { ...(prev.editPrompts || {}), [activeKey]: e.target.value },
              }))}
              // Wer mehrere Aenderungen hintereinander probiert, soll dafuer
              // nicht jedes Mal zur Maus greifen.
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canEdit) {
                  e.preventDefault();
                  handleEdit();
                }
              }}
              disabled={isDemoMode}
              rows={4}
              placeholder={isDemoMode ? 'Bearbeitung ist im Vorschau-Modus deaktiviert.' : 'z. B. mehr Licht, ruhigerer Hintergrund, stärkerer Fokus'}
              className="w-full resize-none rounded-none border border-svt-green/20 bg-white/70 p-4 text-base font-light leading-relaxed text-black outline-none transition-colors duration-200 placeholder:text-black/55 focus:border-svt-green disabled:cursor-not-allowed disabled:bg-svt-cream/60 md:text-[15px]"
            />

            {editError && (
              <ErrorDisplay
                error={editError}
                onRetry={editError.retryable ? handleEdit : undefined}
                onDismiss={() => setEditError(null)}
              />
            )}

            {/* Drei Zustaende wie beim Hauptknopf: waehrend der Ueberarbeitung
                bleibt er gruen und zeigt die laufende Linie, statt wie
                „gesperrt" auszusehen. */}
            <button
              type="button"
              onClick={handleEdit}
              disabled={!canEdit}
              aria-busy={isEditing}
              className={`svt-press t-rail relative flex min-h-[48px] w-full items-center justify-center gap-2 overflow-hidden border px-4 ${
                isEditing
                  ? 'cursor-wait border-svt-green bg-svt-green text-svt-cream'
                  : canEdit
                    ? 'border-svt-green text-svt-green hover:bg-svt-green hover:text-svt-cream'
                    : 'cursor-not-allowed border-svt-green/25 text-black/35'
              }`}
            >
              {isEditing ? 'Wird überarbeitet …' : isDemoMode ? 'Bearbeitung deaktiviert' : 'Änderung anwenden'}
              {isEditing && <span aria-hidden="true" className="svt-sweep absolute bottom-0 left-0 h-[2px] w-1/3 bg-svt-sand" />}
            </button>
            {!isDemoMode && <p className="text-[12px] text-black/60">⌘ / Strg + Enter wendet die Änderung an.</p>}
          </div>

          <div className="space-y-4 border-t border-svt-green/15 pt-8">
            <RailLabel index={2}>Speichern</RailLabel>
            {downloadError ? (
              <p role="alert" className="border-l-2 border-black bg-svt-cream px-4 py-3 text-[13px] text-black/80">
                {downloadError}
              </p>
            ) : null}

            {!currentImage ? (
              // Vorher lag hier ein Knopf, der bei fehlendem Bild still nichts tat.
              <p className="text-[13px] text-black/55">Für dieses Format gibt es nichts zu speichern.</p>
            ) : currentDownloadHref ? (
              <a href={currentDownloadHref} className={DOWNLOAD_CLASS}>
                <span className="t-untertitel text-sm">Herunterladen · {activeLabel}</span>
                <Download size={18} aria-hidden="true" className="transition-transform duration-200 ease-svt-out group-hover:translate-y-0.5" />
              </a>
            ) : currentImage.startsWith('data:') && !isDemoMode ? (
              <form
                action={`/api/download-embedded-image?${new URLSearchParams({
                  filename: getDownloadFilename(),
                }).toString()}`}
                method="post"
                encType="text/plain"
              >
                <input type="hidden" name="image_data" value={currentImage} />
                <button type="submit" className={DOWNLOAD_CLASS}>
                  <span className="t-untertitel text-sm">Herunterladen · {activeLabel}</span>
                  <Download size={18} aria-hidden="true" className="transition-transform duration-200 ease-svt-out group-hover:translate-y-0.5" />
                </button>
              </form>
            ) : (
              <button type="button" onClick={handleEmbeddedImageDownload} className={DOWNLOAD_CLASS}>
                <span className="t-untertitel text-sm">Speichern · {activeLabel}</span>
                <Download size={18} aria-hidden="true" className="transition-transform duration-200 ease-svt-out group-hover:translate-y-0.5" />
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default ImageWorkspace;
