/**
 * Tyrannus AI Media — API Client
 * All Gemini calls are proxied through the FastAPI backend.
 * The API key never touches the browser.
 */

import { Metaphor, ImageSize, GeneratedImages, AspectRatio } from "../types";

// ─── Error Handling ──────────────────────────────────────────────────────────

async function handleResponse(response: Response): Promise<any> {
  if (!response.ok) {
    let detail = `Server-Fehler (${response.status})`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // Response wasn't JSON
    }
    throw new Error(detail);
  }
  return response.json();
}

// ─── Brainstorm (Metaphor Generation) ────────────────────────────────────────

export const generateMetaphors = async (
  verse: string,
  theme: string,
  userVision: string,
  styleMode: "classic" | "modern" = "classic",
  referenceImage: string | null = null
): Promise<Metaphor[]> => {
  const response = await fetch("/api/brainstorm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verse,
      theme,
      userVision,
      styleMode,
      referenceImage,
    }),
  });

  return handleResponse(response);
};

// ─── Multi-Format Image Generation ──────────────────────────────────────────

export const generateMultiFormatImages = async (
  metaphorPrompt: string,
  size: ImageSize,
  requests: { key: string; ratio: AspectRatio }[],
  styleMode: "classic" | "modern" = "classic",
  referenceImage: string | null = null
): Promise<GeneratedImages> => {
  const response = await fetch("/api/generate-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metaphorPrompt,
      imageSize: size,
      requests,
      styleMode,
      referenceImage,
    }),
  });

  return handleResponse(response);
};

// ─── Image Editing ───────────────────────────────────────────────────────────

export const editImage = async (
  currentImageBase64: string,
  editInstruction: string
): Promise<string> => {
  const response = await fetch("/api/edit-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64: currentImageBase64,
      editInstruction,
    }),
  });

  const data = await handleResponse(response);
  return data.image;
};