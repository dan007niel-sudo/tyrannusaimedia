export interface Metaphor {
  id: string;
  title: string;
  description: string;
  visualPrompt: string;
}

export type ImageSize = '1K' | '2K' | '4K';

// Supported API Aspect Ratios
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export interface GeneratedImages {
  [key: string]: string | null;
}

export interface GeneratedImageErrors {
  [key: string]: {
    message: string;
    errorType: string;
    retryable: boolean;
  };
}

export interface GenerationState {
  step: 'input' | 'brainstorm' | 'result' | 'motion';
  isGenerating: boolean;
  error: string | null;
}

// ─── Bewegtbild (Stufe „Ambient") ────────────────────────────────────────────

/**
 * `atem` und `licht` sind cosinus-periodisch und schliessen die Schleife
 * bit-genau. `pushin` ist linear und wird per Ueberblendung geschlossen,
 * `staub` kostet etwa das Doppelte an Renderzeit — beide sind deshalb nicht
 * vorausgewaehlt.
 */
export type MotionPreset = 'atem' | 'licht' | 'pushin' | 'staub';

/** feed = 4:5 unbeschnitten, story = 9:16 mit Auffüller, banner = 16:9 (Beschnitt). */
export type MotionFormat = 'feed' | 'story' | 'banner';

export interface MotionResult {
  format: MotionFormat;
  label: string;
  width: number;
  height: number;
  duration: number;
  seconds: number;
  url: string;
  publicUrl: string | null;
}

export interface MotionJob {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: { done: number; total: number; current: string | null };
  presets: MotionPreset[];
  results: MotionResult[];
  error: string | null;
}

export interface MotionSettings {
  presets: MotionPreset[];
  formats: MotionFormat[];
  duration: number;
  /** Vertikale Lage des 16:9-Ausschnitts, 0 = oben, 1 = unten. */
  bannerOffset: number;
}

export interface AppData {
  verse: string;
  theme: string;
  userVision: string; // Specific user requests
  referenceImage: string | null; // Base64 string of uploaded reference image
  styleMode: 'classic' | 'modern'; // Style preference
  metaphors: Metaphor[];
  selectedMetaphorId: string | null;
  generatedImages: GeneratedImages; 
  generatedImageErrors: GeneratedImageErrors;
  imageSize: ImageSize;
  // Configuration for generation
  selectedFormats: {
    feed: boolean;   // 3:4
    story: boolean;  // 9:16
    banner: boolean; // 16:9
    custom: boolean; // Custom toggle
  };
  customRatio: AspectRatio; // The specific ratio for 'custom'
}
