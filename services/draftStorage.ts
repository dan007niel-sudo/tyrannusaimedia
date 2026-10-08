import { AppData, GenerationState } from '../types';

const DATABASE_NAME = 'tyrannus-media-local';
const DATABASE_VERSION = 1;
const STORE_NAME = 'drafts';
const CURRENT_DRAFT_ID = 'current';

export interface SavedDraft {
  id: typeof CURRENT_DRAFT_ID;
  version: 1;
  savedAt: string;
  data: AppData;
  step: GenerationState['step'];
  currentProjectId: string | null;
  motionSource: string | null;
}

export class DraftValidationError extends Error {
  constructor() {
    super('Der lokale Entwurf ist beschädigt oder stammt aus einer nicht unterstützten Version.');
    this.name = 'DraftValidationError';
  }
}

const STEPS = new Set(['input', 'brainstorm', 'result', 'motion']);
const RATIOS = new Set(['1:1', '3:4', '4:3', '4:5', '9:16', '16:9']);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isStringMap = (value: unknown, allowNull = false) => isRecord(value) && Object.values(value).every(item => typeof item === 'string' || (allowNull && item === null));

function isSavedDraft(value: unknown): value is SavedDraft {
  if (!isRecord(value) || value.id !== CURRENT_DRAFT_ID || value.version !== 1) return false;
  if (typeof value.savedAt !== 'string' || Number.isNaN(Date.parse(value.savedAt))) return false;
  if (typeof value.step !== 'string' || !STEPS.has(value.step)) return false;
  if (!(value.currentProjectId === null || typeof value.currentProjectId === 'string')) return false;
  if (!(value.motionSource === null || typeof value.motionSource === 'string')) return false;
  if (!isRecord(value.data)) return false;
  const data = value.data;
  if (![data.verse, data.theme, data.userVision].every(item => typeof item === 'string')) return false;
  if (!(data.referenceImage === null || typeof data.referenceImage === 'string')) return false;
  if (data.styleMode !== 'classic' && data.styleMode !== 'modern') return false;
  if (!Array.isArray(data.metaphors) || !data.metaphors.every(item => isRecord(item)
    && [item.id, item.title, item.description, item.visualPrompt].every(field => typeof field === 'string'))) return false;
  if (!(data.selectedMetaphorId === null || typeof data.selectedMetaphorId === 'string')) return false;
  if (!isStringMap(data.generatedImages, true) || !isRecord(data.generatedImageErrors)
    || !Object.values(data.generatedImageErrors).every(error => isRecord(error)
      && typeof error.message === 'string'
      && typeof error.errorType === 'string'
      && typeof error.retryable === 'boolean')) return false;
  if (data.imageSize !== '1K' && data.imageSize !== '2K' && data.imageSize !== '4K') return false;
  if (!isRecord(data.selectedFormats)
    || !['feed', 'story', 'banner', 'custom'].every(key => typeof data.selectedFormats[key] === 'boolean')) return false;
  if (typeof data.customRatio !== 'string' || !RATIOS.has(data.customRatio)) return false;
  if (!isStringMap(data.editPrompts)) return false;
  return true;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Dieser Browser unterstützt keine lokale Entwurfsspeicherung.'));
      return;
    }
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Entwurfsspeicher konnte nicht geöffnet werden.'));
  });
}

async function useStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error('Entwurf konnte nicht gespeichert werden.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Entwurfsspeicherung wurde abgebrochen.'));
      // A successful request is not yet a durable write: quota and storage
      // errors can still abort the transaction. Report "saved" only after the
      // transaction itself committed.
      transaction.oncomplete = () => resolve(result);
    });
  } finally {
    database.close();
  }
}

export async function loadDraft(): Promise<SavedDraft | undefined> {
  const value: unknown = await useStore('readonly', store => store.get(CURRENT_DRAFT_ID));
  if (value === undefined) return undefined;
  if (!isSavedDraft(value)) throw new DraftValidationError();
  return value;
}

export function saveDraft(draft: Omit<SavedDraft, 'id' | 'version' | 'savedAt'>): Promise<IDBValidKey> {
  return useStore('readwrite', store => store.put({
    ...draft,
    id: CURRENT_DRAFT_ID,
    version: 1,
    savedAt: new Date().toISOString(),
  } satisfies SavedDraft));
}

export function deleteDraft(): Promise<undefined> {
  return useStore('readwrite', store => store.delete(CURRENT_DRAFT_ID));
}
