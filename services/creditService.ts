export type CreditState = 'unconfigured' | 'unknown' | 'stale' | 'warning' | 'estimated' | 'depleted';

export interface CreditStatus {
  state: CreditState;
  estimatedReserveUsd: number | null;
  warningThresholdUsd: number | null;
  lastConfirmedAt: string | null;
  staleAfterHours: number | null;
  reason: string | null;
  caveat: string;
}

export interface CreditConfigInput {
  confirmedBalanceUsd: number;
  warningThresholdUsd: number;
  brainstormAllowanceUsd: number;
  image1kAllowanceUsd: number;
  image2kAllowanceUsd: number;
  image4kAllowanceUsd: number;
  editAllowanceUsd: number;
  staleAfterHours: number;
}

export interface StoredCreditConfig {
  confirmed_balance_usd: number;
  warning_threshold_usd: number;
  brainstorm_allowance_usd: number;
  image_1k_allowance_usd: number;
  image_2k_allowance_usd: number;
  image_4k_allowance_usd: number;
  edit_allowance_usd: number;
  stale_after_hours: number;
  confirmed_at: string;
}

const HISTORY_HEADER = 'X-History-Token';
export const CREDIT_STATUS_CHANGED = 'tyrannus-credit-status-changed';

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    let detail = body?.detail;
    if (typeof detail === 'string') {
      try { detail = JSON.parse(detail); } catch { /* plain server detail */ }
    }
    throw new Error(detail?.message ?? detail ?? `Server-Fehler (${response.status})`);
  }
  return body as T;
}

export async function fetchCreditStatus(): Promise<CreditStatus> {
  return readJson(await fetch('/api/credit-status', { cache: 'no-store' }));
}

export async function fetchCreditAdmin(token: string): Promise<{ status: CreditStatus; config: StoredCreditConfig | null }> {
  return readJson(await fetch('/api/admin/credit-estimate', {
    cache: 'no-store',
    headers: { [HISTORY_HEADER]: token.trim() },
  }));
}

export async function updateCreditAdmin(token: string, input: CreditConfigInput): Promise<{ saved: true; status: CreditStatus }> {
  const result = await readJson<{ saved: true; status: CreditStatus }>(await fetch('/api/admin/credit-estimate', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', [HISTORY_HEADER]: token.trim() },
    body: JSON.stringify(input),
  }));
  window.dispatchEvent(new Event(CREDIT_STATUS_CHANGED));
  return result;
}

export function announceCreditStatusChanged(): void {
  window.dispatchEvent(new Event(CREDIT_STATUS_CHANGED));
}
