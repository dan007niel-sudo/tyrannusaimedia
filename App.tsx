import React, { useState, useCallback, useRef } from 'react';
import { AppData, GenerationState, AspectRatio, Metaphor } from './types';
import InputSection from './components/InputSection';
import MetaphorSelection from './components/MetaphorSelection';
import ImageWorkspace from './components/ImageWorkspace';
import MotionWorkspace from './components/MotionWorkspace';
import ErrorDisplay, { AppError } from './components/ErrorDisplay';
import ProjectHistory from './components/ProjectHistory';
import { StepTrack } from './components/StepRail';
import { BackendStatus, useBackendStatus } from './services/backendStatus';
import { generateMetaphors, generateMultiFormatImages, extractAppError } from './services/geminiService';
import { Clock, Eye, Film } from 'lucide-react';
import { createDemoAppData, createDemoImages, DEMO_METAPHORS, isDemoMode } from './utils/demoMode';

// ─── Schule von Tyrannus Logo ────────────────────────────────────────────────

const TyrannusLogo = () => (
  <img
    src="/brand/schule-von-tyrannus-logo.png"
    alt="Schule von Tyrannus"
    className="brand-logo block h-auto w-[156px] md:w-[214px]"
    width="884"
    height="301"
  />
);

// Kurz gehalten: auf 375 px teilt sich die Kopfzeile Logo, Historie und Status.
const STATUS_LABEL: Record<BackendStatus, string> = {
  waking: 'Startet',
  ready: 'Bereit',
  offline: 'Offline',
};

// ─── Main Application ────────────────────────────────────────────────────────

const App: React.FC = () => {
  const demoMode = isDemoMode();
  // In der Vorschau wird nichts aufgerufen — also auch nichts geweckt.
  const backendStatus = useBackendStatus(!demoMode);
  const [data, setData] = useState<AppData>(() => demoMode
    ? createDemoAppData()
    : {
      verse: '',
      theme: '',
      userVision: '',
      referenceImage: null,
      styleMode: 'classic',
      metaphors: [],
      selectedMetaphorId: null,
      generatedImages: {},
      generatedImageErrors: {},
      imageSize: '1K',
      selectedFormats: {
        feed: true,
        story: true,
        banner: true,
        custom: false,
      },
      customRatio: '1:1',
    });

  const [state, setState] = useState<GenerationState>({
    step: demoMode ? 'result' : 'input',
    isGenerating: false,
    error: null,
  });

  // Structured error state
  const [appError, setAppError] = useState<AppError | null>(null);

  // Track last action for retry
  const lastActionRef = useRef<'brainstorm' | 'generate' | null>(null);

  // Project history panel
  const [historyOpen, setHistoryOpen] = useState(false);

  // Current project ID (from Supabase)
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  // Flyer, der im Bewegtbild-Schritt animiert wird. Kommt entweder aus einem
  // erzeugten Bild oder aus einem eigenen Upload — der zweite Fall ist der
  // haeufigere: der Flyer existiert meist schon.
  const [motionSource, setMotionSource] = useState<string | null>(null);

  const openMotion = (source: string | null) => {
    setMotionSource(source);
    clearError();
    setState(prev => ({ ...prev, step: 'motion' }));
  };

  // ─── Error Handling ──────────────────────────────────────────────────────

  const handleError = (error: any) => {
    console.error('App error:', error);
    const structured = extractAppError(error);
    setAppError(structured);
    setState(prev => ({ ...prev, isGenerating: false, error: null }));
  };

  const clearError = () => setAppError(null);

  // ─── Retry ───────────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    clearError();
    if (lastActionRef.current === 'brainstorm') {
      handleBrainstorm();
    } else if (lastActionRef.current === 'generate') {
      handleGenerateImage();
    }
  }, []);

  const handleAdjustPrompt = () => {
    clearError();
    setState(prev => ({ ...prev, step: 'input' }));
  };

  // ─── Load Project from History ────────────────────────────────────────────

  const handleLoadProject = (projectId: string, partialData: Partial<AppData>, metaphors: Metaphor[]) => {
    setData(prev => ({
      ...prev,
      ...partialData,
      metaphors,
      selectedMetaphorId: metaphors.length > 0 ? metaphors[0].id : null,
      generatedImageErrors: {},
    }));
    setCurrentProjectId(projectId);

    // If there are images, go to result; if metaphors, go to brainstorm
    if (partialData.generatedImages && Object.keys(partialData.generatedImages).length > 0) {
      setState(prev => ({ ...prev, step: 'result', error: null }));
    } else if (metaphors.length > 0) {
      setState(prev => ({ ...prev, step: 'brainstorm', error: null }));
    } else {
      setState(prev => ({ ...prev, step: 'input', error: null }));
    }
    clearError();
  };

  // ─── Brainstorm ──────────────────────────────────────────────────────────

  const handleBrainstorm = useCallback(async () => {
    if (!data.verse || !data.theme) return;

    lastActionRef.current = 'brainstorm';
    clearError();
    setState(prev => ({ ...prev, isGenerating: true, error: null }));

    if (demoMode) {
      setData(prev => ({
        ...prev,
        metaphors: DEMO_METAPHORS,
        selectedMetaphorId: prev.selectedMetaphorId ?? DEMO_METAPHORS[0].id,
        generatedImageErrors: {},
      }));
      setCurrentProjectId(null);
      window.setTimeout(() => {
        setState(prev => ({ ...prev, step: 'brainstorm', isGenerating: false }));
      }, 250);
      return;
    }

    try {
      const result = await generateMetaphors(
        data.verse,
        data.theme,
        data.userVision,
        data.styleMode,
        data.referenceImage
      );
      setData(prev => ({ ...prev, metaphors: result.metaphors }));
      setCurrentProjectId(result.projectId);
      setState(prev => ({ ...prev, step: 'brainstorm', isGenerating: false }));
    } catch (error: any) {
      handleError(error);
    }
  }, [data.verse, data.theme, data.userVision, data.styleMode, data.referenceImage, demoMode]);

  // ─── Image Generation ────────────────────────────────────────────────────

  const handleGenerateImage = useCallback(async () => {
    const selected = data.metaphors.find(m => m.id === data.selectedMetaphorId);
    if (!selected) return;

    lastActionRef.current = 'generate';
    clearError();
    setState(prev => ({ ...prev, isGenerating: true, error: null }));

    const requests: { key: string; ratio: AspectRatio }[] = [];
    if (data.selectedFormats.feed) requests.push({ key: 'feed', ratio: '4:5' });
    if (data.selectedFormats.story) requests.push({ key: 'story', ratio: '9:16' });
    if (data.selectedFormats.banner) requests.push({ key: 'banner', ratio: '16:9' });
    if (data.selectedFormats.custom) requests.push({ key: 'custom', ratio: data.customRatio });

    if (requests.length === 0) {
      setAppError({
        message: 'Bitte wähle mindestens ein Format aus.',
        errorType: 'UNKNOWN',
        retryable: false,
      });
      setState(prev => ({ ...prev, isGenerating: false }));
      return;
    }

    if (demoMode) {
      const demoImages = createDemoImages();
      const selectedImages = Object.fromEntries(
        requests.map((request) => [request.key, demoImages[request.key] ?? demoImages.feed])
      );
      window.setTimeout(() => {
        setData(prev => ({
          ...prev,
          generatedImages: selectedImages,
          generatedImageErrors: {},
        }));
        setState(prev => ({ ...prev, step: 'result', isGenerating: false }));
      }, 250);
      return;
    }

    try {
      const result = await generateMultiFormatImages(
        selected.visualPrompt,
        data.imageSize,
        requests,
        data.styleMode,
        data.referenceImage,
        currentProjectId,
        data.selectedMetaphorId,
      );
      const displayImages = Object.fromEntries(
        Object.entries(result.images).map(([key, image]) => [
          key,
          result.storedUrls[key] || image,
        ]),
      );
      setData(prev => ({ ...prev, generatedImages: displayImages, generatedImageErrors: result.errors }));
      setState(prev => ({ ...prev, step: 'result', isGenerating: false }));
    } catch (error: any) {
      handleError(error);
    }
  }, [data.metaphors, data.selectedMetaphorId, data.imageSize, data.selectedFormats, data.customRatio, data.styleMode, data.referenceImage, currentProjectId, demoMode]);

  // ─── Render Content ──────────────────────────────────────────────────────

  const renderContent = () => {
    if (state.step === 'input') {
      return (
        <InputSection
          data={data}
          setData={setData}
          onNext={handleBrainstorm}
          isLoading={state.isGenerating}
          isDemoMode={demoMode}
        />
      );
    }
    if (state.step === 'brainstorm') {
      return (
        <MetaphorSelection
          data={data}
          setData={setData}
          onGenerate={handleGenerateImage}
          onBack={() => setState(s => ({ ...s, step: 'input' }))}
          isLoading={state.isGenerating}
          isDemoMode={demoMode}
        />
      );
    }
    if (state.step === 'result') {
      const firstImage = Object.values(data.generatedImages).find(Boolean) as string | undefined;
      return (
        <div className="w-full">
          <ImageWorkspace
            data={data}
            setData={setData}
            onBack={() => setState(s => ({ ...s, step: 'brainstorm' }))}
            isDemoMode={demoMode}
          />
          {firstImage && (
            // Uebergabe an Schritt 4 — als Zeile im selben Raster wie der Rest,
            // nicht als zentrierter Einzelknopf ohne Zusammenhang.
            <div className="mt-12 border-t border-svt-green/15 pt-10">
              <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="t-rail flex items-center gap-3 text-svt-green">
                    <span className="tabular">04</span>
                    <span className="block h-px w-6 bg-current" aria-hidden="true" />
                    Bewegung
                  </p>
                  <p className="mt-2 text-[14px] text-black/60">Aus dem Standbild einen ruhigen Loop für Story, Feed oder Fernseher machen.</p>
                </div>
                <button
                  type="button"
                  onClick={() => openMotion(firstImage)}
                  className="svt-press t-rail inline-flex min-h-[44px] items-center gap-2 bg-svt-green px-6 py-3 text-svt-cream hover:bg-black"
                >
                  <Film size={13} aria-hidden="true" /> Dieses Bild in Bewegung bringen
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }
    if (state.step === 'motion') {
      return (
        <MotionWorkspace
          sourceImage={motionSource}
          onBack={() => setState(s => ({ ...s, step: motionSource ? 'result' : 'input' }))}
          isDemoMode={demoMode}
        />
      );
    }

    return <InputSection data={data} setData={setData} onNext={handleBrainstorm} isLoading={state.isGenerating} isDemoMode={demoMode} />;
  };

  // ─── App Shell ───────────────────────────────────────────────────────────

  return (
    <div className="svt-surface flex min-h-screen flex-col text-black selection:bg-svt-green selection:text-svt-cream">

      {/* Kopfzeile: Logo, Schrittfigur, Werkzeuge. Flach und ohne Unschaerfe —
          Blur ist fuer Ebenen, die etwas verdecken, nicht zur Dekoration. */}
      <header className="sticky top-0 z-50 border-b border-svt-green/15 bg-svt-paper">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 md:gap-6 md:px-10 md:py-4">
          <div className="flex-shrink-0">
            <TyrannusLogo />
          </div>

          <div className="hidden md:block">
            <StepTrack current={state.step} />
          </div>

          <div className="flex items-center gap-2">
            {!demoMode ? (
              // Auf dem Handy nur das Symbol — mit aria-label, damit der Knopf
              // seinen Namen behaelt. 44 px: kleinste zuverlaessige Tippflaeche.
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                aria-label="Historie"
                className="svt-press t-rail flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 border border-svt-green/20 px-3 text-black/70 hover:border-black hover:text-black"
              >
                <Clock size={12} className="text-svt-green" aria-hidden="true" />
                <span className="hidden sm:inline">Historie</span>
              </button>
            ) : null}

            {demoMode ? (
              <div className="t-rail flex min-h-[44px] items-center gap-2 bg-svt-green px-3 text-svt-cream">
                <Eye size={12} aria-hidden="true" />
                Vorschau
              </div>
            ) : (
              // Echter Zustand statt festem „Bereit". Die laufende Linie gibt es
              // nur, solange der Server aufwacht — hoechstens eine Minute, danach
              // steht der Chip still. Dauerhafte Bewegung waere Rauschen.
              <div
                role="status"
                aria-live="polite"
                title={backendStatus === 'waking' ? 'Der Server schläft nach 15 Minuten ohne Nutzung ein und braucht bis zu einer Minute.' : undefined}
                className={`t-rail relative flex min-h-[44px] items-center gap-2 overflow-hidden px-3 ${
                  backendStatus === 'offline' ? 'border border-svt-sand bg-svt-cream text-black' : 'bg-svt-green text-svt-cream'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 ${
                    backendStatus === 'ready' ? 'bg-svt-sand' : backendStatus === 'waking' ? 'bg-svt-cream/50' : 'bg-black'
                  }`}
                />
                {STATUS_LABEL[backendStatus]}
                {backendStatus === 'waking' && (
                  <>
                    <span className="sr-only">— der Server wacht auf, das kann bis zu einer Minute dauern</span>
                    <span aria-hidden="true" className="svt-sweep absolute bottom-0 left-0 h-[2px] w-1/3 bg-svt-sand" />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-svt-green/10 px-4 py-2.5 md:hidden">
          <StepTrack current={state.step} />
        </div>
      </header>

      {demoMode ? (
        <div className="t-rail border-b border-svt-sand bg-svt-green px-4 py-3 text-center text-svt-cream">
          Besucher-Vorschau — KI-Generierung, Bearbeitung, Speicherung und Historie sind deaktiviert.
        </div>
      ) : null}

      {/* Main Content */}
      <main className="mx-auto flex w-full max-w-[1400px] flex-grow flex-col items-center px-4 py-12 md:px-10 md:py-20">
        {/* Structured Error Display */}
        {appError && (
          <ErrorDisplay
            error={appError}
            onRetry={appError.retryable ? handleRetry : undefined}
            onAdjustPrompt={appError.errorType === 'CONTENT_BLOCKED' ? handleAdjustPrompt : undefined}
            onDismiss={clearError}
          />
        )}
        {renderContent()}

        {/* Eigenstaendiger Einstieg: der woechentliche Fall ist ein Flyer, der
            schon fertig ist — dafuer braucht es die Konzeptphase nicht. Gleiches
            Spaltenraster wie das Formular darueber. */}
        {state.step === 'input' && (
          <aside className="svt-rise mt-16 w-full max-w-5xl border-t border-svt-green/15 pt-10 md:mt-20">
            <div className="grid gap-4 md:grid-cols-[var(--rail)_1fr] md:gap-10">
              <p className="t-rail text-svt-green md:pt-1">Direkt</p>
              <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="t-untertitel text-sm">Der Flyer ist schon fertig?</p>
                  <p className="mt-1 text-[13px] text-black/55">Ohne Konzeptphase: hochladen, Bewegung wählen, fertig.</p>
                </div>
                <button
                  type="button"
                  onClick={() => openMotion(null)}
                  className="svt-press t-rail inline-flex min-h-[44px] items-center gap-2 border border-black px-5 py-3 hover:bg-black hover:text-svt-paper"
                >
                  <Film size={13} aria-hidden="true" /> Flyer animieren
                </button>
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* Project History Panel */}
      <ProjectHistory
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onLoadProject={handleLoadProject}
      />

    </div>
  );
};

export default App;
