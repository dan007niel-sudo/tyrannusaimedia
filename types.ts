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

export interface GenerationState {
  step: 'input' | 'brainstorm' | 'result';
  isGenerating: boolean;
  error: string | null;
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