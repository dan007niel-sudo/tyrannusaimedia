import React from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert, Clock, Ban, WifiOff, HelpCircle, Pencil } from 'lucide-react';

export interface AppError {
  message: string;
  errorType: 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'TIMEOUT' | 'CONTENT_BLOCKED' | 'MODEL_UNAVAILABLE' | 'SERVER_ERROR' | 'NETWORK_ERROR' | 'UNKNOWN';
  retryable: boolean;
}

interface ErrorDisplayProps {
  error: AppError;
  onRetry?: () => void;
  onAdjustPrompt?: () => void;
  onDismiss: () => void;
}

const ERROR_CONFIG: Record<string, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  title: string;
}> = {
  PERMISSION_DENIED: {
    icon: <ShieldAlert size={18} />,
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    title: 'Zugriff verweigert',
  },
  RATE_LIMITED: {
    icon: <Clock size={18} />,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    title: 'Rate-Limit erreicht',
  },
  TIMEOUT: {
    icon: <Clock size={18} />,
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    title: 'Zeitüberschreitung',
  },
  CONTENT_BLOCKED: {
    icon: <Ban size={18} />,
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    title: 'Inhalt blockiert',
  },
  MODEL_UNAVAILABLE: {
    icon: <WifiOff size={18} />,
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    title: 'Modell nicht verfügbar',
  },
  SERVER_ERROR: {
    icon: <WifiOff size={18} />,
    color: 'text-zinc-700',
    bgColor: 'bg-zinc-50',
    borderColor: 'border-zinc-200',
    title: 'Serverfehler',
  },
  NETWORK_ERROR: {
    icon: <WifiOff size={18} />,
    color: 'text-zinc-700',
    bgColor: 'bg-zinc-50',
    borderColor: 'border-zinc-200',
    title: 'Netzwerkfehler',
  },
  UNKNOWN: {
    icon: <HelpCircle size={18} />,
    color: 'text-zinc-700',
    bgColor: 'bg-zinc-50',
    borderColor: 'border-zinc-200',
    title: 'Fehler',
  },
};

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, onRetry, onAdjustPrompt, onDismiss }) => {
  const config = ERROR_CONFIG[error.errorType] || ERROR_CONFIG.UNKNOWN;

  return (
    <div className={`w-full max-w-xl ${config.bgColor} border ${config.borderColor} p-6 rounded-sm mb-8 animate-in slide-in-from-top-2 shadow-sm`}>
      {/* Header */}
      <div className={`flex items-center gap-2 mb-3 ${config.color}`}>
        {config.icon}
        <span className="font-bold uppercase tracking-widest text-xs">{config.title}</span>
      </div>

      {/* Message */}
      <p className={`text-sm leading-relaxed mb-4 ${config.color} opacity-90`}>
        {error.message}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {error.retryable && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-800 transition-colors rounded-sm"
          >
            <RefreshCw size={12} />
            Erneut versuchen
          </button>
        )}

        {error.errorType === 'CONTENT_BLOCKED' && onAdjustPrompt && (
          <button
            onClick={onAdjustPrompt}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-300 text-black text-xs font-bold uppercase tracking-widest hover:border-black transition-colors rounded-sm"
          >
            <Pencil size={12} />
            Prompt anpassen
          </button>
        )}

        <button
          onClick={onDismiss}
          className="text-xs text-zinc-400 hover:text-black transition-colors uppercase tracking-widest font-medium ml-auto"
        >
          Schließen
        </button>
      </div>
    </div>
  );
};

export default ErrorDisplay;
