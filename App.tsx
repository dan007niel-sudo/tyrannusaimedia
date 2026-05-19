import React, { useState, useCallback, useRef } from 'react';
import { AppData, GenerationState, AspectRatio, Metaphor } from './types';
import InputSection from './components/InputSection';
import MetaphorSelection from './components/MetaphorSelection';
import ImageWorkspace from './components/ImageWorkspace';
import ErrorDisplay, { AppError } from './components/ErrorDisplay';
import ProjectHistory from './components/ProjectHistory';
import { generateMetaphors, generateMultiFormatImages, extractAppError } from './services/geminiService';
import { Clock } from 'lucide-react';

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
  const [data, setData] = useState<AppData>({
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
        data.referenceImage,
        currentProjectId,
        data.selectedMetaphorId,
      );
      setData(prev => ({ ...prev, generatedImages: result.images, generatedImageErrors: result.errors }));
      setState(prev => ({ ...prev, step: 'result', isGenerating: false }));
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
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/70 hover:bg-white border border-black/10 hover:border-black transition-all cursor-pointer"
            >
              <Clock size={12} className="text-[#1F3A2E]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 hover:text-black">Historie</span>
            </button>

            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-[#1F3A2E] text-white border border-[#1F3A2E]">
              <div className="w-1.5 h-1.5 bg-[#D6C3A3] animate-pulse"></div>
              <span className="text-[10px] font-bold uppercase tracking-widest">
                <span className="sm:hidden">Ready</span>
                <span className="hidden sm:inline">System Ready</span>
              </span>
            </div>
          </div>
        </div>
      </header>

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
