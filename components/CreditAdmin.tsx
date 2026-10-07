import React, { useEffect, useState } from 'react';
import { CreditConfigInput, fetchCreditAdmin, updateCreditAdmin } from '../services/creditService';

interface CreditAdminProps { isOpen: boolean; onClose: () => void; }
const TOKEN_KEY = 'tyrannus-history-token';
const readStoredToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } };
const EMPTY: Record<keyof CreditConfigInput, string> = {
  confirmedBalanceUsd: '', warningThresholdUsd: '', brainstormAllowanceUsd: '',
  image1kAllowanceUsd: '', image2kAllowanceUsd: '', image4kAllowanceUsd: '',
  editAllowanceUsd: '', staleAfterHours: '72',
};

const fields: { key: keyof CreditConfigInput; label: string; step: string; min: string }[] = [
  { key: 'confirmedBalanceUsd', label: 'Aktuelles Gemini-Guthaben (USD)', step: '0.01', min: '0' },
  { key: 'warningThresholdUsd', label: 'Warnschwelle (USD)', step: '0.01', min: '0' },
  { key: 'brainstormAllowanceUsd', label: 'Reserve je Konzeptphase (USD)', step: '0.0001', min: '0.0001' },
  { key: 'image1kAllowanceUsd', label: 'Reserve je Bild 1K (USD)', step: '0.0001', min: '0.0001' },
  { key: 'image2kAllowanceUsd', label: 'Reserve je Bild 2K (USD)', step: '0.0001', min: '0.0001' },
  { key: 'image4kAllowanceUsd', label: 'Reserve je Bild 4K (USD)', step: '0.0001', min: '0.0001' },
  { key: 'editAllowanceUsd', label: 'Reserve je Bearbeitung (USD)', step: '0.0001', min: '0.0001' },
  { key: 'staleAfterHours', label: 'Nach wie vielen Stunden neu bestätigen', step: '1', min: '1' },
];

const CreditAdmin: React.FC<CreditAdminProps> = ({ isOpen, onClose }) => {
  const [token, setToken] = useState(readStoredToken);
  const [values, setValues] = useState(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [previousConfirmation, setPreviousConfirmation] = useState<{ balance: number; at: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadConfiguration = async (candidate = token) => {
    if (!candidate.trim()) { setMessage('Trage zuerst das Historie-Token ein.'); return; }
    setLoading(true); setMessage(null);
    try {
      const { config } = await fetchCreditAdmin(candidate);
      if (!config) { setMessage('Reserve noch nicht eingerichtet. Trage alle Werte aus der Abrechnung ein.'); return; }
      setValues({
        // An old confirmed balance is context, never today's balance. Reusing
        // it would reset the estimate to a number nobody checked today.
        confirmedBalanceUsd: '',
        warningThresholdUsd: String(config.warning_threshold_usd),
        brainstormAllowanceUsd: String(config.brainstorm_allowance_usd),
        image1kAllowanceUsd: String(config.image_1k_allowance_usd),
        image2kAllowanceUsd: String(config.image_2k_allowance_usd),
        image4kAllowanceUsd: String(config.image_4k_allowance_usd),
        editAllowanceUsd: String(config.edit_allowance_usd),
        staleAfterHours: String(config.stale_after_hours),
      });
      setPreviousConfirmation({ balance: config.confirmed_balance_usd, at: config.confirmed_at });
      setMessage('Kostenansätze und Warnschwelle geladen. Den aktuellen Kontostand bitte frisch bei Google prüfen und neu eintragen.');
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const candidate = token.trim() || readStoredToken();
    if (!token.trim() && candidate) setToken(candidate);
    if (candidate) loadConfiguration(candidate);
    // The stored token is checked once when the panel opens. A newly typed
    // token is used on explicit save, never sent once per keystroke.
  }, [isOpen]);

  if (!isOpen) return null;
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setMessage(null);
    try {
      const parsed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])) as unknown as CreditConfigInput;
      if (Object.values(parsed).some(value => !Number.isFinite(value)) || parsed.staleAfterHours < 1) throw new Error('Bitte alle Werte vollständig und als positive Zahlen eintragen.');
      const result = await updateCreditAdmin(token, parsed);
      try { sessionStorage.setItem(TOKEN_KEY, token.trim()); } catch { /* in-memory still works */ }
      setPreviousConfirmation({ balance: parsed.confirmedBalanceUsd, at: result.status.lastConfirmedAt ?? new Date().toISOString() });
      setValues(prev => ({ ...prev, confirmedBalanceUsd: '' }));
      setMessage('Neue Guthabenbasis bestätigt und gespeichert.');
    } catch (error: any) { setMessage(error.message); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/55 p-4 md:p-10" role="dialog" aria-modal="true" aria-label="Geschätzte Reserve verwalten">
      <form onSubmit={save} className="w-full max-w-2xl bg-svt-paper p-6 md:p-9">
        <div className="flex items-start justify-between gap-4">
          <div><p className="t-rail text-svt-green">Administration</p><h2 className="t-untertitel mt-2 text-xl">Geschätzte Reserve</h2></div>
          <button type="button" onClick={onClose} className="svt-press t-rail min-h-[44px] border border-black/20 px-4">Schließen</button>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-black/65">Trage den aktuell in Google bestätigten Gesamtstand ein, nicht nur den letzten Aufladebetrag. Die Kostenansätze müssen bewusst konservativ sein. Diese Anzeige kennt keine Nutzung durch andere Apps und keine automatische Aufladung.</p>
        {previousConfirmation ? (
          <p className="mt-4 border-l-2 border-svt-sand bg-svt-cream px-4 py-3 text-[13px] text-black/70">
            Letzte Referenz: {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' }).format(previousConfirmation.balance)} · {new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(previousConfirmation.at))}. Dieser alte Wert wird nicht als aktueller Kontostand übernommen.
          </p>
        ) : null}
        <label className="t-rail mt-7 block text-black/60">Historie-Token<input type="password" required value={token} onChange={e => setToken(e.target.value)} className="mt-2 block min-h-[44px] w-full border border-svt-green/25 bg-white px-3 text-base font-normal normal-case tracking-normal" /></label>
        <button type="button" onClick={() => loadConfiguration()} disabled={loading || !token.trim()} className="svt-press t-rail mt-2 min-h-[44px] border border-svt-green/25 px-4 text-svt-green disabled:opacity-45">Gespeicherte Werte laden</button>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {fields.map(field => <label key={field.key} className="text-[13px] text-black/65">{field.label}<input type="number" required min={field.min} step={field.step} value={values[field.key]} onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))} className="mt-1 block min-h-[44px] w-full border border-svt-green/25 bg-white px-3 text-base text-black" /></label>)}
        </div>
        {message && <p role="status" className="mt-5 border-l-2 border-svt-sand bg-svt-cream px-4 py-3 text-sm">{message}</p>}
        <button type="submit" disabled={loading} className="svt-press t-rail mt-6 min-h-[48px] bg-svt-green px-6 text-svt-cream disabled:opacity-45">{loading ? 'Wird geprüft …' : 'Aktuellen Stand bestätigen'}</button>
      </form>
    </div>
  );
};

export default CreditAdmin;
