import React, { useState, useCallback, useRef } from 'react';
import { AppData, GenerationState, AspectRatio, Metaphor } from './types';
import InputSection from './components/InputSection';
import MetaphorSelection from './components/MetaphorSelection';
import ImageWorkspace from './components/ImageWorkspace';
import MotionWorkspace from './components/MotionWorkspace';
import ErrorDisplay, { AppError } from './components/ErrorDisplay';
import ProjectHistory from './components/ProjectHistory';
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

// ─── Main Application ────────────────────────────────────────────────────────

const App: React.FC = () => {
  const demoMode = isDemoMode();
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
    if (data.selectedFormats.feed) requests.push({ key: 'feed', ratio: '3:4' });
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
            <div className="mt-10 flex justify-center border-t border-black/10 pt-8">
              <button
                onClick={() => openMotion(firstImage)}
                className="flex items-center gap-2 border border-black px-5 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors hover:bg-black hover:text-white"
              >
                <Film size={12} /> Dieses Bild in Bewegung bringen
              </button>
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
    <div className="brand-surface min-h-screen text-black selection:bg-black selection:text-white flex flex-col">

      {/* Header */}
      <header className="px-4 md:px-10 py-3 md:py-4 border-b border-black/10 flex flex-row justify-between items-center bg-[#fbfaf7]/95 backdrop-blur-sm sticky top-0 z-50 gap-4">
        
        {/* Logo */}
        <div className="flex-shrink-0">
          <TyrannusLogo />
        </div>

        {/* Status + History */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            {/* History Button */}
            {!demoMode ? (
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/70 hover:bg-white border border-black/10 hover:border-black transition-all cursor-pointer"
              >
                <Clock size={12} className="text-[#1F3A2E]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 hover:text-black">Historie</span>
              </button>
            ) : null}

            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-[#1F3A2E] text-white border border-[#1F3A2E]">
              {demoMode ? (
                <Eye size={12} aria-hidden="true" />
              ) : (
                <div className="w-1.5 h-1.5 bg-[#D6C3A3] animate-pulse"></div>
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest">
                {demoMode ? (
                  <span>Vorschau</span>
                ) : (
                  <>
                    <span className="sm:hidden">Ready</span>
                    <span className="hidden sm:inline">System Ready</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </header>

      {demoMode ? (
        <div className="border-b border-[#D6C3A3] bg-[#1F3A2E] px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-white">
          Besucher-Vorschau: KI-Generierung, Bearbeitung, Speicherung und Historie sind deaktiviert.
        </div>
      ) : null}

      {/* Main Content */}
      <main className="container mx-auto px-4 py-9 md:py-14 flex flex-col items-center justify-center flex-grow">
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
            schon fertig ist — dafuer braucht es die Konzeptphase nicht. */}
        {state.step === 'input' && (
          <div className="mt-10 w-full max-w-3xl border-t border-black/10 pt-8 text-center">
            <button
              onClick={() => openMotion(null)}
              className="inline-flex items-center gap-2 border border-black/20 px-5 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors hover:border-black hover:bg-black hover:text-white"
            >
              <Film size={12} /> Fertigen Flyer animieren
            </button>
            <p className="mt-2 text-[11px] text-zinc-500">
              Ohne Konzeptphase: Flyer hochladen, Bewegung wählen, fertig.
            </p>
          </div>
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
