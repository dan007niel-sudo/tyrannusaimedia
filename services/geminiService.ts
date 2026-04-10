/**
 * Tyrannus AI Media — API Client
 * All Gemini calls are proxied through the FastAPI backend.
 * The API key never touches the browser.
 *
 * Features:
 * - Structured error handling with error types
 * - AbortController timeout for long-running requests
 * - User-friendly German error messages
 */

import { Metaphor, ImageSize, GeneratedImages, AspectRatio } from "../types";
import { AppError } from "../components/ErrorDisplay";

// ─── Constants ───────────────────────────────────────────────────────────────

const BRAINSTORM_TIMEOUT_MS = 60_000;   // 60 seconds
const IMAGE_GEN_TIMEOUT_MS = 180_000;   // 3 minutes (images take longer)
const EDIT_TIMEOUT_MS = 150_000;        // 2.5 minutes

// ─── Error Handling ──────────────────────────────────────────────────────────

function createAppError(message: string, errorType: AppError['errorType'], retryable: boolean): AppError {
  return { message, errorType, retryable };
}

/**
 * Parse a backend response into a structured AppError.
 * The backend sends JSON detail with { message, errorType, retryable }.
 */
async function handleResponse(response: Response): Promise<any> {
  if (!response.ok) {
    let appError: AppError;

    try {
      const body = await response.json();

      // Backend sends structured error as JSON in detail field
      if (body.detail) {
        let detail: any;
        // detail could be a JSON string or already parsed object
        if (typeof body.detail === 'string') {
          try {
            detail = JSON.parse(body.detail);
          } catch {
            detail = { message: body.detail };
          }
        } else {
          detail = body.detail;
        }

        appError = createAppError(
          detail.message || `Server-Fehler (${response.status})`,
          detail.errorType || mapHttpToErrorType(response.status),
          detail.retryable ?? isRetryableStatus(response.status),
        );
      } else {
        appError = createAppError(
          `Server-Fehler (${response.status})`,
          mapHttpToErrorType(response.status),
          isRetryableStatus(response.status),
        );
      }
    } catch {
      appError = createAppError(
        `Server-Fehler (${response.status})`,
        mapHttpToErrorType(response.status),
        isRetryableStatus(response.status),
      );
    }

    // Throw as an Error with the AppError attached
    const err = new Error(appError.message) as Error & { appError: AppError };
    err.appError = appError;
    throw err;
  }
  return response.json();
}

function mapHttpToErrorType(status: number): AppError['errorType'] {
  switch (status) {
    case 403: case 401: return 'PERMISSION_DENIED';
    case 422: return 'CONTENT_BLOCKED';
    case 429: return 'RATE_LIMITED';
    case 504: return 'TIMEOUT';
    case 502: case 503: return 'SERVER_ERROR';
    default: return 'UNKNOWN';
  }
}

function isRetryableStatus(status: number): boolean {
  return [429, 500, 502, 503, 504].includes(status);
}

/**
 * Create a fetch call with an AbortController timeout.
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      const err = new Error('Die Anfrage hat zu lange gedauert. Bitte versuche es erneut.') as Error & { appError: AppError };
      err.appError = createAppError(
        'Die Anfrage hat zu lange gedauert. Bitte versuche es erneut oder verwende eine niedrigere Auflösung.',
        'TIMEOUT',
        true,
      );
      throw err;
    }

    // Network error (offline, DNS failure, etc.)
    const err = new Error('Netzwerkfehler — bitte prüfe deine Internetverbindung.') as Error & { appError: AppError };
    err.appError = createAppError(
      'Netzwerkfehler — bitte prüfe deine Internetverbindung und versuche es erneut.',
      'NETWORK_ERROR',
      true,
    );
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract AppError from any thrown error.
 */
export function extractAppError(error: any): AppError {
  // If it already has an appError attached
  if (error?.appError) return error.appError;

  // Fallback: create from message
  return createAppError(
    error?.message || 'Ein unbekannter Fehler ist aufgetreten.',
    'UNKNOWN',
    true,
  );
}

// ─── Brainstorm (Metaphor Generation) ────────────────────────────────────────

export const generateMetaphors = async (
  verse: string,
  theme: string,
  userVision: string,
  styleMode: "classic" | "modern" = "classic",
  referenceImage: string | null = null
): Promise<{ metaphors: Metaphor[]; projectId: string | null }> => {
  const response = await fetchWithTimeout("/api/brainstorm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verse,
      theme,
      userVision,
      styleMode,
      referenceImage,
    }),
  }, BRAINSTORM_TIMEOUT_MS);

  const data = await handleResponse(response);
  return { metaphors: data.metaphors, projectId: data.projectId || null };
};

// ─── Multi-Format Image Generation ──────────────────────────────────────────

export const generateMultiFormatImages = async (
  metaphorPrompt: string,
  size: ImageSize,
  requests: { key: string; ratio: AspectRatio }[],
  styleMode: "classic" | "modern" = "classic",
  referenceImage: string | null = null
): Promise<{ images: GeneratedImages; storedUrls: Record<string, string> }> => {
  const response = await fetchWithTimeout("/api/generate-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metaphorPrompt,
      imageSize: size,
      requests,
      styleMode,
      referenceImage,
    }),
  }, IMAGE_GEN_TIMEOUT_MS);

  const data = await handleResponse(response);
  return { images: data.images, storedUrls: data.storedUrls || {} };
};

// ─── Image Editing ───────────────────────────────────────────────────────────

export const editImage = async (
  currentImageBase64: string,
  editInstruction: string
): Promise<string> => {
  const response = await fetchWithTimeout("/api/edit-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64: currentImageBase64,
      editInstruction,
    }),
  }, EDIT_TIMEOUT_MS);

  const data = await handleResponse(response);
  return data.image;
};

// ─── Project History ──────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  verse: string;
  theme: string;
  style_mode: string;
  created_at: string;
}

export interface ProjectDetail {
  project: {
    id: string;
    verse: string;
    theme: string;
    user_vision: string;
    style_mode: string;
    created_at: string;
  };
  metaphors: {
    id: string;
    title: string;
    description: string;
    visual_prompt: string;
    is_selected: boolean;
  }[];
  images: {
    id: string;
    format_key: string;
    aspect_ratio: string;
    public_url: string;
  }[];
}

export const fetchProjects = async (): Promise<ProjectSummary[]> => {
  const response = await fetchWithTimeout("/api/projects", {}, 10_000);
  return handleResponse(response);
};

export const fetchProject = async (projectId: string): Promise<ProjectDetail> => {
  const response = await fetchWithTimeout(`/api/projects/${projectId}`, {}, 10_000);
  return handleResponse(response);
};

export const deleteProject = async (projectId: string): Promise<void> => {
  await fetchWithTimeout(`/api/projects/${projectId}`, { method: "DELETE" }, 10_000);
};

export const saveImageReferences = async (
  projectId: string,
  images: Record<string, string>,
  metaphorId?: string | null,
): Promise<void> => {
  await fetchWithTimeout("/api/save-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, metaphorId, images }),
  }, 10_000);
};