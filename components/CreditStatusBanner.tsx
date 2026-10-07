import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CreditCard } from 'lucide-react';
import { CREDIT_STATUS_CHANGED, CreditStatus, fetchCreditStatus } from '../services/creditService';

const formatUsd = (value: number) => new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(value);

const CreditStatusBanner: React.FC = () => {
  const [status, setStatus] = useState<CreditStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchCreditStatus());
    } catch {
      setStatus({
        state: 'unknown', estimatedReserveUsd: null, warningThresholdUsd: null,
        lastConfirmedAt: null, staleAfterHours: null, reason: 'request_failed',
        caveat: 'Nur Verbrauch dieser App; andere Apps und automatische Aufladungen sind nicht enthalten.',
      });
    }
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refreshWhenVisible();
    const interval = window.setInterval(() => {
      refreshWhenVisible();
    }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener(CREDIT_STATUS_CHANGED, refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener(CREDIT_STATUS_CHANGED, refreshWhenVisible);
    };
  }, [refresh]);

  if (!status) return null;
  const copy = status.state === 'depleted'
    ? 'Der Anbieter hat gemeldet, dass das KI-Guthaben aufgebraucht ist.'
    : status.state === 'warning'
      ? status.estimatedReserveUsd !== null ? `Geschätzte Reserve knapp: ${formatUsd(status.estimatedReserveUsd)}.` : 'Geschätzte Reserve ist knapp.'
      : status.state === 'stale'
        ? 'Geschätzte Reserve muss neu bestätigt werden.'
        : status.state === 'estimated'
          ? status.estimatedReserveUsd !== null ? `Geschätzte Reserve: ${formatUsd(status.estimatedReserveUsd)}.` : 'Reserve-Schätzung basiert auf der letzten manuellen Bestätigung.'
          : status.state === 'unconfigured'
            ? 'Geschätzte Reserve ist noch nicht eingerichtet.'
            : 'Geschätzte Reserve ist derzeit unbekannt.';

  const urgent = ['depleted', 'warning', 'stale', 'unknown'].includes(status.state);
  return (
    <div role="status" className={`border-b px-4 py-3 md:px-10 ${urgent ? 'border-svt-sand bg-svt-cream' : 'border-svt-green/10 bg-white/70'}`}>
      <div className="mx-auto flex max-w-[1400px] items-start gap-3 text-[13px] text-black/75">
        {urgent ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-svt-green" aria-hidden="true" /> : <CreditCard size={15} className="mt-0.5 shrink-0 text-svt-green" aria-hidden="true" />}
        <p>
          <strong>{copy}</strong>{' '}
          <span className="text-black/55">{status.caveat}</span>
        </p>
      </div>
    </div>
  );
};

export default CreditStatusBanner;
