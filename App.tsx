import React, { useState, useCallback, useRef } from 'react';
import { AppData, GenerationState, AspectRatio, Metaphor } from './types';
import InputSection from './components/InputSection';
import MetaphorSelection from './components/MetaphorSelection';
import ImageWorkspace from './components/ImageWorkspace';
import ErrorDisplay, { AppError } from './components/ErrorDisplay';
import ProjectHistory from './components/ProjectHistory';
import { generateMetaphors, generateMultiFormatImages, saveImageReferences, extractAppError } from './services/geminiService';
import { Clock } from 'lucide-react';

// ─── Tyrannus AI Media Logo ──────────────────────────────────────────────────

const TyrannusLogo = () => (
  <div className="flex flex-col items-center justify-center text-black select-none pointer-events-none">
    {/* House Icon */}
    <svg viewBox="0 0 100 60" className="h-8 w-auto fill-black mb-2">
      <path d="M50 5 L10 35 L10 55 L90 55 L90 35 L50 5 Z M60 12 L60 25 L75 25 L75 24 L60 12 Z" />
      <rect x="58" y="10" width="8" height="20" className="fill-black" />
    </svg>
    
    {/* Main Text */}
    <div className="flex flex-col items-center leading-none">
      <h1 className="font-serif-logo text-2xl font-bold tracking-[0.15em] mb-1">SCHULE</h1>
      <div className="text-[0.6rem] tracking-[0.4em] font-light uppercase text-zinc-600 mb-2">Von Tyrannus</div>
    </div>
    
    {/* Separator */}
    <div className="flex items-center gap-2 opacity-50 mb-1">
      <div className="h-[1px] w-12 bg-black"></div>
      <div className="w-1 h-1 rotate-45 bg-black"></div>
      <div className="h-[1px] w-12 bg-black"></div>
    </div>
    
    {/* Slogan */}
    <div className="text-[0.5rem] tracking-[0.2em] uppercase font-bold text-zinc-900">
      AI Media Studio
    </div>
  </div>
);

// ─── Main Application ────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [data, setData] = useState<AppData>({
    verse: '',
    theme: '',
    userVision: '',
    referenceImage: null,
    styleMode: 'classic',
    metaphors: [],
    selectedMetaphorId: null,
    generatedImages: {},
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
    step: 'input',
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

  const handleLoadProject = (partialData: Partial<AppData>, metaphors: Metaphor[]) => {
    setData(prev => ({
      ...prev,
      ...partialData,
      metaphors,
      selectedMetaphorId: metaphors.length > 0 ? metaphors[0].id : null,
    }));

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
  }, [data.verse, data.theme, data.userVision, data.styleMode, data.referenceImage]);

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

    try {
      const result = await generateMultiFormatImages(
        selected.visualPrompt,
        data.imageSize,
        requests,
        data.styleMode,
        data.referenceImage
      );
      setData(prev => ({ ...prev, generatedImages: result.images }));
      setState(prev => ({ ...prev, step: 'result', isGenerating: false }));

      // Save image references to Supabase (non-blocking)
      if (currentProjectId && result.storedUrls && Object.keys(result.storedUrls).length > 0) {
        saveImageReferences(currentProjectId, result.storedUrls, data.selectedMetaphorId).catch(e => {
          console.warn('Failed to save image references:', e);
        });
      }
    } catch (error: any) {
      handleError(error);
    }
  }, [data.metaphors, data.selectedMetaphorId, data.imageSize, data.selectedFormats, data.customRatio, data.styleMode, data.referenceImage, currentProjectId]);

  // ─── Render Content ──────────────────────────────────────────────────────

  const renderContent = () => {
    if (state.step === 'input') {
      return (
        <InputSection
          data={data}
          setData={setData}
          onNext={handleBrainstorm}
          isLoading={state.isGenerating}
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
        />
      );
    }
    if (state.step === 'result') {
      return (
        <ImageWorkspace
          data={data}
          setData={setData}
          onBack={() => setState(s => ({ ...s, step: 'brainstorm' }))}
        />
      );
    }

    return <InputSection data={data} setData={setData} onNext={handleBrainstorm} isLoading={state.isGenerating} />;
  };

  // ─── App Shell ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white text-black selection:bg-black selection:text-white flex flex-col">

      {/* Header */}
      <header className="px-8 py-8 border-b border-zinc-100 flex flex-col md:flex-row justify-between items-center bg-white/95 backdrop-blur-sm sticky top-0 z-50 gap-6">
        
        {/* Logo */}
        <div className="flex-shrink-0 scale-90 origin-left">
          <TyrannusLogo />
        </div>

        {/* Status + History */}
        <div className="hidden md:flex flex-col items-end gap-2">
          <div className="flex items-center gap-4">
            {/* History Button */}
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-zinc-50 rounded-full border border-zinc-200 hover:border-black transition-all cursor-pointer"
            >
              <Clock size={12} className="text-zinc-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-black">Historie</span>
            </button>

            <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-50 rounded-full border border-zinc-100">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">System Ready</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12 flex flex-col items-center justify-center flex-grow">
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