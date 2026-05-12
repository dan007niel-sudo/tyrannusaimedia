import React, { useState, useEffect } from 'react';
import { X, Clock, Trash2, ChevronRight, Loader2, BookOpen, KeyRound } from 'lucide-react';
import { fetchProjects, fetchProject, deleteProject, ProjectSummary } from '../services/geminiService';
import { AppData, Metaphor } from '../types';

interface ProjectHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadProject: (projectId: string, data: Partial<AppData>, metaphors: Metaphor[]) => void;
}

const HISTORY_TOKEN_STORAGE_KEY = 'tyrannus-history-token';

const readStoredHistoryToken = () => {
  try {
    return sessionStorage.getItem(HISTORY_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

const writeStoredHistoryToken = (token: string) => {
  try {
    if (token) {
      sessionStorage.setItem(HISTORY_TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(HISTORY_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Browsers can block storage in private or hardened modes. The in-memory token still works.
  }
};

const ProjectHistory: React.FC<ProjectHistoryProps> = ({ isOpen, onClose, onLoadProject }) => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProject, setLoadingProject] = useState<string | null>(null);
  const [historyToken, setHistoryToken] = useState(readStoredHistoryToken);
  const [tokenDraft, setTokenDraft] = useState(historyToken);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (historyToken.trim()) {
        loadProjects(historyToken);
      } else {
        setProjects([]);
        setError(null);
      }
    }
  }, [isOpen]);

  const loadProjects = async (token = historyToken): Promise<boolean> => {
    if (!token.trim()) return false;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProjects(token);
      setProjects(data);
      return true;
    } catch (e: any) {
      console.error('Failed to load projects:', e);
      setError(e?.appError?.message || 'Projekt-Historie konnte nicht geladen werden.');
      setProjects([]);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextToken = tokenDraft.trim();

    if (!nextToken) {
      setHistoryToken('');
      writeStoredHistoryToken('');
      setProjects([]);
      setError(null);
      return;
    }

    const tokenWorks = await loadProjects(nextToken);
    if (tokenWorks) {
      setHistoryToken(nextToken);
      setTokenDraft(nextToken);
      writeStoredHistoryToken(nextToken);
    }
  };

  const handleForgetToken = () => {
    setHistoryToken('');
    setTokenDraft('');
    setProjects([]);
    setError(null);
    writeStoredHistoryToken('');
  };

  const handleLoadProject = async (projectId: string) => {
    setLoadingProject(projectId);
    setError(null);
    try {
      const detail = await fetchProject(projectId, historyToken);

      // Map DB metaphors to app Metaphor type
      const metaphors: Metaphor[] = detail.metaphors.map(m => ({
        id: m.id,
        title: m.title,
        description: m.description,
        visualPrompt: m.visual_prompt,
      }));

      // Build generatedImages from stored image URLs
      const generatedImages: Record<string, string | null> = {};
      for (const img of detail.images) {
        generatedImages[img.format_key] = img.public_url;
      }

      onLoadProject(
        detail.project.id,
        {
          verse: detail.project.verse,
          theme: detail.project.theme,
          userVision: detail.project.user_vision || '',
          styleMode: (detail.project.style_mode as 'classic' | 'modern') || 'classic',
          metaphors,
          generatedImages,
        },
        metaphors,
      );
      onClose();
    } catch (e: any) {
      console.error('Failed to load project:', e);
      setError(e?.appError?.message || 'Projekt konnte nicht geladen werden.');
    } finally {
      setLoadingProject(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!confirm('Projekt wirklich löschen? Alle Bilder gehen verloren.')) return;

    setError(null);
    try {
      await deleteProject(projectId, historyToken);
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (e: any) {
      console.error('Failed to delete project:', e);
      setError(e?.appError?.message || 'Projekt konnte nicht gelöscht werden.');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/35 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-[#fbfaf7] shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300 border-l border-black">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-black/10">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-zinc-400" />
            <h2 className="font-brand-display text-lg font-black tracking-[-0.03em]">Projekt-Historie</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Auth */}
        <form onSubmit={handleSaveToken} className="p-4 border-b border-black/10 bg-white/55">
          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
            <KeyRound size={12} />
            Historie-Token
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="Admin-Token eingeben"
              className="min-w-0 flex-1 bg-white border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
            />
            <button
              type="submit"
              className="bg-black text-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-[#1F3A2E] transition-colors"
            >
              Laden
            </button>
          </div>
          {historyToken && (
            <button
              type="button"
              onClick={handleForgetToken}
              className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-black transition-colors"
            >
              Token vergessen
            </button>
          )}
          {error && (
            <p className="mt-2 text-xs text-red-600 leading-relaxed">{error}</p>
          )}
        </form>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
              <Loader2 size={24} className="animate-spin mb-3" />
              <span className="text-xs uppercase tracking-widest">Lade Projekte...</span>
            </div>
          ) : !historyToken.trim() ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-300">
              <KeyRound size={32} className="mb-4" />
              <p className="text-sm font-medium text-zinc-400">Historie geschützt</p>
              <p className="text-xs text-zinc-300 mt-1 text-center max-w-xs">
                Gib das Admin-Token ein, um gespeicherte Projekte zu laden.
              </p>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-300">
              <BookOpen size={32} className="mb-4" />
              <p className="text-sm font-medium text-zinc-400">Noch keine Projekte</p>
              <p className="text-xs text-zinc-300 mt-1">Erstelle dein erstes Projekt über den Editor.</p>
            </div>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                onClick={() => handleLoadProject(project.id)}
                className="group relative bg-white/78 border border-black/10 hover:border-black p-5 cursor-pointer transition-all hover:shadow-md"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-black truncate">{project.verse}</h3>
                    <p className="text-xs text-zinc-500 font-light truncate mt-0.5">{project.theme}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    {loadingProject === project.id ? (
                      <Loader2 size={14} className="animate-spin text-zinc-400" />
                    ) : (
                      <ChevronRight size={14} className="text-zinc-300 group-hover:text-black transition-colors" />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-sm ${
                      project.style_mode === 'modern'
                        ? 'bg-[#1F3A2E] text-white'
                        : 'bg-[#D6C3A3]/35 text-[#1F3A2E]'
                    }`}>
                      {project.style_mode === 'modern' ? 'Modern' : 'Klassisch'}
                    </span>
                    <span className="text-[10px] text-zinc-300">
                      {formatDate(project.created_at)}
                    </span>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, project.id)}
                    className="p-1.5 text-zinc-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectHistory;
