import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Clock, KeyRound, Trash2, X } from 'lucide-react';
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

/** Dauer der Ausfahrt — muss zur CSS-Animation `svt-drawer-out` passen. */
const EXIT_MS = 180;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Seitenleiste mit gespeicherten Entwuerfen.
 *
 * Vorher war sie optisch eine Leiste, technisch aber kein Dialog: kein Escape,
 * der Fokus blieb draussen, und die Tastatur tabbte hinter der Abdeckung
 * weiter durch die App. Jetzt: `role="dialog"`, Fokus beim Oeffnen hinein und
 * beim Schliessen zurueck auf den ausloesenden Knopf, Tab bleibt in der Leiste.
 */
const ProjectHistory: React.FC<ProjectHistoryProps> = ({ isOpen, onClose, onLoadProject }) => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProject, setLoadingProject] = useState<string | null>(null);
  const [historyToken, setHistoryToken] = useState(readStoredHistoryToken);
  const [tokenDraft, setTokenDraft] = useState(historyToken);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

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

  // Fokus hinein beim Oeffnen, zurueck beim Schliessen — sonst landet ein
  // Tastaturnutzer nach dem Schliessen irgendwo am Seitenanfang.
  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const target =
      panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      returnFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  // Kurze Ausfahrt statt hartem Verschwinden. Die Leiste bleibt dafuer 180 ms
  // montiert; Ausfahrt ist bewusst schneller als Einfahrt.
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, EXIT_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

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
      requestClose();
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
      {/* Abdeckung: flach, ohne Unschaerfe. 40 % Schwarz trennt die Leiste
          deutlich vom Hintergrund und kostet — anders als Blur — nichts. */}
      <div
        aria-hidden="true"
        onClick={requestClose}
        className={`fixed inset-0 z-50 bg-black/40 ${closing ? 'svt-fade-out' : 'svt-fade-in'}`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onKeyDown={handleKeyDown}
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-black bg-svt-paper ${
          closing ? 'svt-drawer-out' : 'svt-drawer-in'
        }`}
      >
        <header className="flex items-start justify-between border-b border-svt-green/15 px-6 py-5">
          <div>
            <p className="t-rail flex items-center gap-2 text-svt-green">
              <Clock size={12} aria-hidden="true" /> Gespeicherte Entwürfe
            </p>
            <h2 id="history-title" className="t-titel mt-3 text-3xl text-black">
              Historie.
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Historie schließen"
            className="svt-press -mr-2 flex h-11 w-11 items-center justify-center text-black/55 hover:text-black"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSaveToken} className="border-b border-svt-green/15 bg-white/50 px-6 py-5">
          <label htmlFor="history-token" className="t-rail flex items-center gap-2 text-black/55">
            <KeyRound size={12} aria-hidden="true" />
            Historie-Token
          </label>
          <div className="mt-3 flex gap-2">
            {/* 16 px auf dem Handy: darunter zoomt iOS beim Fokussieren. */}
            <input
              id="history-token"
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="Admin-Token"
              autoComplete="current-password"
              data-autofocus={!historyToken.trim() ? true : undefined}
              className="min-w-0 flex-1 rounded-none border border-svt-green/25 bg-white px-3 py-2.5 text-base outline-none focus:border-svt-green md:text-sm"
            />
            <button type="submit" className="svt-press t-rail min-h-[44px] bg-svt-green px-4 text-svt-cream hover:bg-black">
              Laden
            </button>
          </div>
          {historyToken && (
            <button
              type="button"
              onClick={handleForgetToken}
              className="svt-press t-rail mt-2 inline-flex min-h-[44px] items-center text-black/60 hover:text-black"
            >
              Token vergessen
            </button>
          )}
          {error && (
            <p role="alert" className="mt-3 border-l-2 border-black bg-svt-cream px-4 py-3 text-[13px] leading-relaxed text-black/80">
              {error}
            </p>
          )}
        </form>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {loading ? (
            <div className="py-20 text-center">
              <span aria-hidden="true" className="relative mx-auto block h-px w-24 overflow-hidden bg-svt-green/15">
                <span className="svt-sweep absolute inset-y-0 left-0 w-1/3 bg-svt-green" />
              </span>
              <p aria-live="polite" className="t-rail mt-4 text-black/60">
                Wird geladen …
              </p>
            </div>
          ) : !historyToken.trim() ? (
            <div className="py-20 text-center">
              <KeyRound size={26} aria-hidden="true" className="mx-auto text-svt-green/35" />
              <p className="t-untertitel mt-4 text-sm text-black/60">Geschützt</p>
              <p className="mx-auto mt-1 max-w-xs text-[13px] text-black/60">
                Mit dem Admin-Token lassen sich gespeicherte Entwürfe öffnen.
              </p>
            </div>
          ) : projects.length === 0 ? (
            <div className="py-20 text-center">
              <p className="t-untertitel text-sm text-black/60">Noch keine Entwürfe</p>
              <p className="mt-1 text-[13px] text-black/60">Gespeichert wird automatisch, sobald Motive entstehen.</p>
            </div>
          ) : (
            <ul className="svt-stagger space-y-2">
              {projects.map((project) => (
                // Laden und Loeschen sind zwei Knoepfe nebeneinander, nicht
                // ineinander: ein Knopf im Knopf ist ungueltig, und das alte
                // <div onClick> war per Tastatur gar nicht erreichbar.
                <li
                  key={project.id}
                  className="group flex border border-svt-green/15 bg-white/70 transition-colors duration-200 hover:border-svt-green/45"
                >
                  <button
                    type="button"
                    onClick={() => handleLoadProject(project.id)}
                    disabled={loadingProject !== null}
                    className="flex min-w-0 flex-1 items-start justify-between gap-3 px-4 py-4 text-left disabled:cursor-wait"
                  >
                    <span className="min-w-0">
                      <span className="t-untertitel block truncate text-sm text-black">{project.verse}</span>
                      <span className="mt-0.5 block truncate text-[13px] italic text-black/55">{project.theme}</span>
                      <span className="mt-3 flex items-center gap-2">
                        <span
                          className={`t-rail px-2 py-1 ${
                            project.style_mode === 'modern' ? 'bg-svt-green text-svt-cream' : 'bg-svt-sand/40 text-svt-green'
                          }`}
                        >
                          {project.style_mode === 'modern' ? 'Modern' : 'Klassisch'}
                        </span>
                        <span className="tabular text-[12px] text-black/60">{formatDate(project.created_at)}</span>
                      </span>
                    </span>
                    {loadingProject === project.id ? (
                      <span aria-live="polite" className="t-rail mt-0.5 shrink-0 text-svt-green">
                        Lädt …
                      </span>
                    ) : (
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-black/50 transition-transform duration-200 ease-svt-out group-hover:translate-x-0.5 group-hover:text-black"
                      />
                    )}
                  </button>
                  {/* Immer sichtbar — vorher nur bei Hover, auf dem Handy also nie. */}
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, project.id)}
                    aria-label={`Entwurf „${project.verse}“ löschen`}
                    className="svt-press flex w-11 shrink-0 items-center justify-center border-l border-svt-green/10 text-black/55 hover:bg-svt-cream hover:text-black"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectHistory;
