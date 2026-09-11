import React, { useState } from 'react';
import { KeyRound, Loader2, Eye } from 'lucide-react';
import { checkTeamAccess, extractAppError } from '../services/geminiService';
import { writeTeamToken } from '../services/teamAccess';

interface AccessGateProps {
  onUnlocked: () => void;
}

/**
 * Tor vor den kostenpflichtigen Teilen der App.
 *
 * Warum ueberhaupt: Die Adresse ist oeffentlich erreichbar. Ohne Tor generiert
 * jeder, der sie kennt, auf Daniels Rechnung — bei Bildern sind das Cent, beim
 * spaeteren Bewegtbild Euro pro Klick.
 *
 * Warum nicht nur die drei Routen, sondern die ganze Oberflaeche: eine Tuer ist
 * fuer ein Team von neun Leuten leichter zu erklaeren als zwei. Die oeffentliche
 * Vorschau (`?demo=1`) bleibt davon unberuehrt — sie ruft ohnehin nichts auf,
 * was kostet, und ist genau dafuer gebaut, Aussenstehenden die App zu zeigen.
 */
const AccessGate: React.FC<AccessGateProps> = ({ onUnlocked }) => {
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = draft.trim();
    if (!token || checking) return;

    setChecking(true);
    setError(null);
    try {
      const ok = await checkTeamAccess(token);
      if (!ok) {
        // Bewusst 401 von allem anderen getrennt: ein nicht eingerichteter
        // Server (503) ist kein falsches Wort, und den Nutzer danach suchen zu
        // lassen waere die falsche Spur.
        setError('Das Zugangswort stimmt nicht.');
        return;
      }
      writeTeamToken(token);
      onUnlocked();
    } catch (err) {
      setError(extractAppError(err).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="brand-surface flex min-h-screen flex-col items-center justify-center px-4 text-black">
      <img
        src="/brand/schule-von-tyrannus-logo.png"
        alt="Schule von Tyrannus"
        className="brand-logo mb-10 block h-auto w-[180px] md:w-[240px]"
        width="884"
        height="301"
      />

      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1F3A2E]">
          Tyrannus AI Media
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Zugang fürs Team</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Das Bildstudio ist dem Social-Media-Team vorbehalten, weil jede
          Generierung Kosten verursacht.
        </p>

        <label htmlFor="team-token" className="mt-8 block text-[10px] font-bold uppercase tracking-widest text-zinc-600">
          Zugangswort
        </label>
        <div className="mt-2 flex items-center gap-2 border border-black/20 bg-white px-3 focus-within:border-[#1F3A2E] focus-within:ring-2 focus-within:ring-[#1F3A2E]">
          <KeyRound size={14} className="flex-shrink-0 text-[#1F3A2E]" aria-hidden="true" />
          <input
            id="team-token"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'team-token-error' : undefined}
            className="w-full bg-transparent py-3 text-sm outline-none"
          />
        </div>

        {error && (
          // role="alert" statt nur Farbe: Screenreader bekommen den Fehler sonst nicht mit.
          <p id="team-token-error" role="alert" className="mt-3 border border-[#D6C3A3] bg-[#D6C3A3]/20 p-3 text-[11px] text-zinc-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!draft.trim() || checking}
          className="mt-6 flex w-full items-center justify-center gap-2 bg-black px-8 py-4 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-[#1F3A2E] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-300"
        >
          {checking ? <Loader2 size={14} className="animate-spin" /> : null}
          {checking ? 'Wird geprüft…' : 'Weiter'}
        </button>
      </form>

      <a
        href="?demo=1"
        className="mt-10 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 underline-offset-4 transition-colors hover:text-black hover:underline"
      >
        <Eye size={12} aria-hidden="true" /> Nur ansehen: Besucher-Vorschau
      </a>
    </div>
  );
};

export default AccessGate;
