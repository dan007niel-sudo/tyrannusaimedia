import React from 'react';
import { ArchiveRestore, Check, Save, Trash2 } from 'lucide-react';
import { SavedDraft } from '../services/draftStorage';

export type DraftSaveState = 'checking' | 'idle' | 'saving' | 'saved' | 'error';

interface DraftControlsProps {
  existingDraft: SavedDraft | null;
  invalidDraft: boolean;
  saveState: DraftSaveState;
  error: string | null;
  onSave: () => void;
  onRestore: () => void;
  onDiscard: () => void;
}

const formatSavedAt = (value: string) => new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const DraftControls: React.FC<DraftControlsProps> = ({ existingDraft, invalidDraft, saveState, error, onSave, onRestore, onDiscard }) => (
  <div className="border-b border-svt-green/10 bg-svt-cream px-4 py-3 md:px-10">
    <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
      {existingDraft || invalidDraft ? (
        <>
          <p className="text-[13px] text-black/70">
            {existingDraft ? <>Lokaler Entwurf vom <strong>{formatSavedAt(existingDraft.savedAt)}</strong> gefunden. Er wird erst nach deiner Auswahl geladen.</> : 'Der lokale Entwurf ist beschädigt oder stammt aus einer nicht unterstützten Version. Er wird nicht geladen.'}
          </p>
          {invalidDraft && error ? <p role="alert" className="text-[13px] text-black/70">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            {existingDraft ? (
              <button type="button" onClick={onRestore} className="svt-press t-rail inline-flex min-h-[44px] items-center gap-2 bg-svt-green px-4 text-svt-cream hover:bg-black">
                <ArchiveRestore size={13} aria-hidden="true" /> Wiederherstellen
              </button>
            ) : null}
            <button type="button" onClick={onDiscard} className="svt-press t-rail inline-flex min-h-[44px] items-center gap-2 border border-black/25 px-4 hover:border-black">
              <Trash2 size={13} aria-hidden="true" /> Verwerfen
            </button>
          </div>
        </>
      ) : (
        <>
          <p role={error ? 'alert' : 'status'} className={`text-[13px] ${error ? 'text-black' : 'text-black/60'}`}>
            {error ?? (saveState === 'checking' ? 'Lokaler Entwurf wird geprüft …' : saveState === 'saving' ? 'Entwurf wird lokal gespeichert …' : saveState === 'saved' ? 'Entwurf lokal gespeichert.' : 'Entwurf wird auf diesem Gerät gesichert.')}
          </p>
          <button type="button" onClick={onSave} disabled={saveState === 'checking' || saveState === 'saving'} className="svt-press t-rail inline-flex min-h-[44px] items-center gap-2 border border-svt-green/25 px-4 text-svt-green hover:border-svt-green disabled:opacity-45">
            {saveState === 'saved' ? <Check size={13} aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
            Jetzt speichern
          </button>
        </>
      )}
    </div>
  </div>
);

export default DraftControls;
