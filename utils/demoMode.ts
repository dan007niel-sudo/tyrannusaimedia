import { AppData, GeneratedImages, Metaphor } from "../types";

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return window.location.pathname === "/demo" || params.get("demo") === "1";
}

export const DEMO_METAPHORS: Metaphor[] = [
  {
    id: "demo-renewed-mind",
    title: "Der erneuerte Blick",
    description:
      "Eine ruhige Bildmetapher fuer Transformation: alte Gedankenmuster werden abgelegt, waehrend Gottes Wahrheit den Blick neu ausrichtet.",
    visualPrompt:
      "A cinematic editorial photograph of a person standing before a softly lit mirror, fragmented paper notes dissolving into warm morning light, symbolic of renewed thinking and spiritual transformation, elegant natural textures, realistic lighting.",
  },
  {
    id: "demo-living-stone",
    title: "Lebendige Steine",
    description:
      "Ein Motiv fuer Gemeinschaft und Aufbau: einzelne Steine werden zu einem tragfaehigen Haus, nicht durch Uniformitaet, sondern durch Verbundenheit.",
    visualPrompt:
      "A realistic editorial scene of diverse natural stones arranged into a growing architectural form, golden seams of light between them, symbolizing unity, service, and spiritual formation, cinematic depth of field.",
  },
  {
    id: "demo-water-in-desert",
    title: "Wasser in der Wuestenstadt",
    description:
      "Eine starke visuelle Richtung fuer Hoffnung: mitten in trockener Umgebung bricht Leben hervor, klar, hell und nicht kitschig.",
    visualPrompt:
      "A modern cinematic photograph of clear water flowing through a dry urban courtyard, green life emerging subtly from cracks in stone, hopeful but restrained, editorial composition, natural light.",
  },
];

function demoSvg(title: string, subtitle: string, width: number, height: number): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fbfaf7"/>
          <stop offset="0.58" stop-color="#e8dfcf"/>
          <stop offset="1" stop-color="#1f3a2e"/>
        </linearGradient>
        <pattern id="grid" width="72" height="72" patternUnits="userSpaceOnUse">
          <path d="M 72 0 L 0 0 0 72" fill="none" stroke="#1f3a2e" stroke-opacity="0.12" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <rect width="${width}" height="${height}" fill="url(#grid)"/>
      <rect x="${width * 0.08}" y="${height * 0.08}" width="${width * 0.84}" height="${height * 0.84}" fill="none" stroke="#111" stroke-width="6"/>
      <circle cx="${width * 0.72}" cy="${height * 0.28}" r="${Math.min(width, height) * 0.16}" fill="#d6c3a3" fill-opacity="0.78"/>
      <path d="M ${width * 0.18} ${height * 0.72} C ${width * 0.32} ${height * 0.5}, ${width * 0.45} ${height * 0.84}, ${width * 0.62} ${height * 0.62} S ${width * 0.82} ${height * 0.48}, ${width * 0.9} ${height * 0.58}" fill="none" stroke="#111" stroke-width="8" stroke-linecap="round"/>
      <text x="${width * 0.12}" y="${height * 0.18}" fill="#111" font-family="Arial, sans-serif" font-size="${Math.max(28, width * 0.045)}" font-weight="800" letter-spacing="3">DEMO</text>
      <text x="${width * 0.12}" y="${height * 0.84}" fill="#111" font-family="Arial, sans-serif" font-size="${Math.max(34, width * 0.055)}" font-weight="800">${title}</text>
      <text x="${width * 0.12}" y="${height * 0.9}" fill="#1f3a2e" font-family="Arial, sans-serif" font-size="${Math.max(18, width * 0.026)}" font-weight="600">${subtitle}</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createDemoImages(): GeneratedImages {
  return {
    feed: demoSvg("Feed-Konzept", "3:4 Vorschau ohne KI-Generierung", 900, 1200),
    story: demoSvg("Story-Konzept", "9:16 Vorschau ohne KI-Generierung", 900, 1600),
    banner: demoSvg("Banner-Konzept", "16:9 Vorschau ohne KI-Generierung", 1600, 900),
  };
}

export function createDemoAppData(): AppData {
  return {
    verse: "Roemer 12:2",
    theme: "Erneuerung des Sinnes",
    userVision: "Editorialer Social-Media-Post fuer ein Medien-Team.",
    referenceImage: null,
    styleMode: "modern",
    metaphors: DEMO_METAPHORS,
    selectedMetaphorId: DEMO_METAPHORS[0].id,
    generatedImages: createDemoImages(),
    generatedImageErrors: {},
    imageSize: "1K",
    selectedFormats: {
      feed: true,
      story: true,
      banner: true,
      custom: false,
    },
    customRatio: "1:1",
  };
}
