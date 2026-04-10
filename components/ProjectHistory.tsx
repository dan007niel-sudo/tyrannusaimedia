import React, { useState, useEffect } from 'react';
import { X, Clock, Trash2, ChevronRight, Loader2, BookOpen } from 'lucide-react';
import { fetchProjects, fetchProject, deleteProject, ProjectSummary } from '../services/geminiService';
import { AppData, Metaphor } from '../types';

interface ProjectHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadProject: (data: Partial<AppData>, metaphors: Metaphor[]) => void;
}

const ProjectHistory: React.FC<ProjectHistoryProps> = ({ isOpen, onClose, onLoadProject }) => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProject, setLoadingProject] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadProjects();
    }
  }, [isOpen]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (e) {
      console.error('Failed to load projects:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadProject = async (projectId: string) => {
    setLoadingProject(projectId);
    try {
      const detail = await fetchProject(projectId);

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
    } catch (e) {
      console.error('Failed to load project:', e);
    } finally {
      setLoadingProject(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!confirm('Projekt wirklich löschen? Alle Bilder gehen verloren.')) return;

    try {
      await deleteProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (e) {
      console.error('Failed to delete project:', e);
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
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-zinc-400" />
            <h2 className="text-lg font-bold tracking-tight">Projekt-Historie</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-100 transition-colors rounded-sm"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
              <Loader2 size={24} className="animate-spin mb-3" />
              <span className="text-xs uppercase tracking-widest">Lade Projekte...</span>
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
                className="group relative bg-white border border-zinc-100 hover:border-black p-5 cursor-pointer transition-all hover:shadow-md"
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
                        ? 'bg-blue-50 text-blue-600' 
                        : 'bg-amber-50 text-amber-600'
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
