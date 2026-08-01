/**
 * Tyrannus AI Media — Bewegtbild-Renderer im Browser (Stufe „Ambient")
 *
 * Macht aus einem statischen Flyer ein nahtlos schleifendes MP4 — Canvas fuer
 * die Bilder, WebCodecs fuer H.264, mp4-muxer fuer den Container. Alles auf dem
 * Rechner desjenigen, der den Flyer ohnehin gerade offen hat.
 *
 * Warum nicht auf dem Server: gemessen am 01.08.2026 gegen die Live-Instanz
 * ueberlebt Render Free (0,1 CPU, 512 MB) selbst den kleinstmoeglichen Auftrag
 * nicht — 480p, 3 Sekunden, ein Format fuehrten nach ~25 s zu 502 und einem
 * Prozess-Neustart. Nicht „langsam", sondern toedlich: ffmpeg hungert den
 * einzigen Worker aus. Der serverseitige Renderer (motion_render.py) bleibt als
 * Referenzimplementierung und fuer die spaetere generative Stufe bestehen.
 *
 * Was der Umzug geschenkt hat: Canvas sampelt mit Float-Quellrechteck nativ
 * subpixelgenau. Die ganze Ueberabtastung um Faktor S, die es in ffmpeg nur
 * gibt, weil `zoompan` auf ganze Pixel quantisiert, faellt hier ersatzlos weg.
 *
 * Was der Umzug NICHT geschenkt hat — die Naht-Mathematik gilt unveraendert:
 *
 *   * Periodische Effekte muessen bei t=0 und t=L identisch sein.
 *     (1-cos(2*PI*t/L))/2 leistet das; die Formel ist aus motion_render.py
 *     uebernommen, nicht neu erfunden.
 *   * Lineare Fahrten (`pushin`) brauchen eine Ueberblendung am ANFANG:
 *         O(t) = (1-w)*A(t) + w*A(t+L)   fuer t < X,  w faellt 1 -> 0
 *     Dann ist O(0) = A(L) und schliesst stetig an O(L-) an. Die naheliegende
 *     Variante „Anfang ans Ende blenden" braeuchte A(t-L) — negative Zeit.
 *   * Und vor allem: die Naht wird GEMESSEN, nicht angeschaut. measureSeam()
 *     unten vergleicht Frame N-1 -> Frame 0 gegen einen Nachbarschritt
 *     derselben Phase. In ffmpeg sind genau so zwei Fehler aufgefallen, die die
 *     Formel allein nicht verhindert hat.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { MotionFormat, MotionPreset, MotionSettings } from '../types';

// ─── Konstanten (aus motion_render.py gespiegelt) ────────────────────────────

export const FORMAT_ASPECT: Record<MotionFormat, [number, number]> = {
  feed: [4, 5],
  story: [9, 16],
  banner: [16, 9],
};

export const FORMAT_LABEL: Record<MotionFormat, string> = {
  feed: 'Feed 4:5',
  story: 'Story 9:16',
  banner: 'TV-Loop 16:9',
};

const ATEM_AMPLITUDE = 0.03;
const PUSHIN_AMPLITUDE = 0.08;
const LICHT_BRIGHTNESS = 0.045;
const LICHT_SATURATION = 0.06;
const STAUB_OPACITY = 0.22;
const SEAM_CROSSFADE_SECONDS = 1.2;

/**
 * Kleiner Grundzoom, damit nie exakt bei Skalierung 1,0 gezeichnet wird.
 *
 * In ffmpeg war das ein echter Nahtfehler: bei Zoom 1,0 verkleinert es ohne
 * Resampling, Frame 0 war dadurch der einzige unbehandelte Frame im Clip. Hier
 * ist die Quelle ohnehin immer groesser als die Zielflaeche, der Fall kann also
 * gar nicht eintreten — der Grundzoom bleibt trotzdem, weil er nichts kostet
 * und die Annahme nicht von der Quellgroesse abhaengen soll.
 */
const ZOOM_BASE = 1.015;

export const DEFAULT_DURATION = 8;
export const DEFAULT_FPS = 30;
export const DEFAULT_SHORT_EDGE = 1080;

export class MotionRenderError extends Error {
  constructor(message: string, readonly detail = '') {
    super(message);
    this.name = 'MotionRenderError';
  }
}

// ─── Verfuegbarkeit ──────────────────────────────────────────────────────────

export function isMotionSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.VideoEncoder === 'function' &&
    typeof window.VideoFrame === 'function' &&
    typeof document.createElement('canvas').getContext === 'function'
  );
}

/**
 * Ersten wirklich funktionierenden H.264-Codec suchen.
 *
 * Die Level-Angabe im Codec-String muss zur Aufloesung passen — ein zu
 * niedriges Level lehnt der Encoder ab. Deshalb von hoch nach niedrig
 * probieren statt einen festen String zu raten.
 *
 * Wichtig: `isConfigSupported()` allein reicht NICHT. Gemessen am 01.08.2026
 * meldete es fuer `avc1.42001f` (Level 3.1) `supported: true`, waehrend
 * `configure()` bei 1080x1350 mit `NotSupportedError` abbrach — die codierte
 * Flaeche uebersteigt das Limit von Level 3.1 deutlich. Ein Encoder, der beim
 * Konfigurieren stirbt, laesst spaeter `flush()` ins Leere warten: der Render
 * haengt dann ohne Fehlermeldung.
 *
 * Deshalb wird jeder Kandidat testweise wirklich konfiguriert.
 */
async function pickCodec(width: number, height: number): Promise<string> {
  const candidates = ['avc1.640034', 'avc1.640028', 'avc1.4D0028', 'avc1.42E028', 'avc1.42001f'];
  const config = (codec: string) => ({
    codec, width, height, bitrate: 6_000_000, framerate: DEFAULT_FPS,
  });

  for (const codec of candidates) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config(codec));
      if (!supported) continue;

      // Gegenprobe: wirklich konfigurieren. Wirft `configure()`, ist der
      // Kandidat unbrauchbar, egal was die Abfrage vorher behauptet hat.
      const probe = new VideoEncoder({ output: () => {}, error: () => {} });
      try {
        probe.configure(config(codec));
        probe.close();
        return codec;
      } catch {
        try { probe.close(); } catch { /* schon geschlossen */ }
      }
    } catch {
      // Nicht unterstuetzte Strings werfen teils, statt `supported: false`
      // zurueckzugeben — beides bedeutet dasselbe.
    }
  }

  throw new MotionRenderError(
    `Dein Browser kann für ${width}×${height} kein H.264-Video erzeugen. ` +
    'Versuch es mit einer kleineren Auflösung, oder nimm Chrome, Edge oder Safari 17+.',
  );
}

// ─── Geometrie ───────────────────────────────────────────────────────────────

export function outputSize(fmt: MotionFormat, shortEdge: number): [number, number] {
  const [aw, ah] = FORMAT_ASPECT[fmt];
  let width: number;
  let height: number;
  if (aw <= ah) {
    width = shortEdge;
    height = Math.round((shortEdge * ah) / aw);
  } else {
    height = shortEdge;
    width = Math.round((shortEdge * aw) / ah);
  }
  // Gerade Kantenlaengen: yuv420p halbiert die Chroma-Ebenen.
  return [width - (width % 2), height - (height % 2)];
}

/**
 * Anteil der Bildhoehe, der beim 16:9-Beschnitt verloren geht.
 *
 * Aus einer 4:5-Quelle bleiben nur 45 % — das muss die UI VOR dem Rendern
 * sagen, nicht hinterher zeigen.
 */
export function bannerCropLoss(srcW: number, srcH: number): number {
  const keptHeight = (srcW * 9) / 16;
  return Math.max(0, 1 - Math.min(1, keptHeight / srcH));
}

// ─── Standbild pro Format ────────────────────────────────────────────────────

/**
 * Baut die Bildflaeche, auf der die Bewegung spaeter stattfindet.
 *
 * Bewusst grosszuegiger als die Ausgabe (FACTOR), damit der Zoom
 * hineinfahren kann, ohne dass Quellpixel fehlen.
 */
function buildCanvas(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  fmt: MotionFormat,
  outW: number,
  outH: number,
  bannerOffset: number,
): HTMLCanvasElement {
  // Etwas Reserve gegen die maximale Zoomstufe.
  const FACTOR = 1.6;
  const cw = Math.round(outW * FACTOR);
  const ch = Math.round(outH * FACTOR);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new MotionRenderError('Canvas konnte nicht erzeugt werden.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (fmt === 'story') {
    // Kein Beschnitt: Flyer vollstaendig mittig, oben und unten eine stark
    // unscharfe, abgedunkelte Kopie seiner selbst. Der Blur laeuft ueber eine
    // Verkleinerung — `filter: blur()` mit grossem Radius auf voller Groesse
    // ist um Groessenordnungen teurer und sieht gleich aus.
    const small = document.createElement('canvas');
    small.width = Math.max(2, Math.round(cw / 12));
    small.height = Math.max(2, Math.round(ch / 12));
    const sctx = small.getContext('2d')!;
    const coverScale = Math.max(small.width / srcW, small.height / srcH);
    const bw = srcW * coverScale;
    const bh = srcH * coverScale;
    sctx.drawImage(source, (small.width - bw) / 2, (small.height - bh) / 2, bw, bh);

    ctx.filter = 'blur(4px) brightness(0.72) saturate(0.55)';
    ctx.drawImage(small, 0, 0, cw, ch);
    ctx.filter = 'none';

    // Flyer vollstaendig hineinpassen (contain).
    const fitScale = Math.min(cw / srcW, ch / srcH);
    const fw = srcW * fitScale;
    const fh = srcH * fitScale;
    ctx.drawImage(source, (cw - fw) / 2, (ch - fh) / 2, fw, fh);
  } else if (fmt === 'banner') {
    // Volle Breite behalten, Hoehe beschneiden; bannerOffset 0..1 schiebt den
    // Ausschnitt vertikal.
    const scale = cw / srcW;
    const scaledH = srcH * scale;
    const offset = Math.min(Math.max(bannerOffset, 0), 1);
    const y = -(scaledH - ch) * offset;
    ctx.drawImage(source, 0, y, cw, scaledH);
  } else {
    // feed — Cover-Beschnitt; bei einer 4:5-Quelle veraendert das nichts.
    const coverScale = Math.max(cw / srcW, ch / srcH);
    const dw = srcW * coverScale;
    const dh = srcH * coverScale;
    ctx.drawImage(source, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  return canvas;
}

/**
 * Staubkachel — deterministische Punktverteilung aus einer Hash-artigen
 * Funktion, damit sie ueber alle Frames stabil bleibt. Vier Kacheln hoch:
 * drei reichen nicht, weil beim Scrollen um eine volle Kachelhoehe sonst unten
 * ein Streifen ohne Staub bleibt — genau das hat in ffmpeg die Naht
 * aufgerissen.
 */
function buildDustStrip(width: number, height: number): { strip: HTMLCanvasElement; tileH: number } {
  const tileH = Math.max(2, Math.ceil(height / 3));
  const strip = document.createElement('canvas');
  strip.width = width;
  strip.height = tileH * 4;
  const ctx = strip.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';

  const hash = (x: number, y: number) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };

  // Innerhalb einer Kachel erzeugen und viermal stapeln → die Kachelgrenzen
  // bleiben unsichtbar und der Streifen ist in sich periodisch.
  const points: [number, number, number][] = [];
  const count = Math.round((width * tileH) / 2600);
  for (let i = 0; i < count; i++) {
    const x = hash(i, 1) * width;
    const y = hash(i, 2) * tileH;
    const r = 0.6 + hash(i, 3) * 1.1;
    points.push([x, y, r]);
  }
  for (let tile = 0; tile < 4; tile++) {
    for (const [x, y, r] of points) {
      ctx.beginPath();
      ctx.arc(x, y + tile * tileH, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return { strip, tileH };
}

// ─── Bewegung ────────────────────────────────────────────────────────────────

/** Zoomfaktor an Frame-Index `n`. Periode ist IMMER `loopFrames`. */
function zoomAt(presets: MotionPreset[], n: number, loopFrames: number): number {
  let z = ZOOM_BASE;
  if (presets.includes('atem')) {
    z += (ATEM_AMPLITUDE * (1 - Math.cos((2 * Math.PI * n) / loopFrames))) / 2;
  }
  if (presets.includes('pushin')) {
    z += (PUSHIN_AMPLITUDE * n) / loopFrames;
  }
  return z;
}

/** Lichtpuls, um null zentriert — bei n=0 und n=loopFrames identisch. */
function pulseAt(n: number, loopFrames: number): number {
  return (1 - Math.cos((2 * Math.PI * n) / loopFrames)) / 2 - 0.5;
}

interface FrameContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  plate: HTMLCanvasElement;
  dust: { strip: HTMLCanvasElement; tileH: number } | null;
  presets: MotionPreset[];
  loopFrames: number;
  outW: number;
  outH: number;
}

/** Zeichnet die Bildflaeche mit dem Zoom von Frame `n` — ohne Staub. */
function drawPlate(fc: FrameContext, n: number, alpha: number): void {
  const { ctx, plate, outW, outH } = fc;
  const zoom = zoomAt(fc.presets, n, fc.loopFrames);

  // Ausschnitt aus der Bildflaeche, mittig. Float-Werte: genau hier sampelt
  // Canvas subpixelgenau, und genau deshalb braucht es keine Ueberabtastung.
  const sw = plate.width / zoom;
  const sh = plate.height / zoom;
  const sx = (plate.width - sw) / 2;
  const sy = (plate.height - sh) / 2;

  ctx.globalAlpha = alpha;
  ctx.drawImage(plate, sx, sy, sw, sh, 0, 0, outW, outH);
  ctx.globalAlpha = 1;
}

/** Rendert Frame `n` vollstaendig in `fc.canvas`. */
function renderFrame(fc: FrameContext, n: number): void {
  const { ctx, outW, outH, loopFrames } = fc;

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, outW, outH);

  // Der Lichtpuls wird an die ZEICHENOPERATION gehaengt, nicht hinterher auf
  // das fertige Bild angewandt. `ctx.filter` wirkt nur beim Zeichnen; das
  // Canvas nachtraeglich auf sich selbst zu zeichnen, um den Filter
  // „anzuwenden", ist browserabhaengig und mit `globalCompositeOperation =
  // 'copy'` sogar gefaehrlich — die Flaeche wird zuerst geleert.
  //
  // Der Puls ist um null zentriert und damit bei n=0 und n=loopFrames
  // identisch; die Naht bleibt geschlossen.
  if (fc.presets.includes('licht')) {
    const p = pulseAt(n, loopFrames);
    ctx.filter = `brightness(${1 + LICHT_BRIGHTNESS * p}) saturate(${1 + LICHT_SATURATION * p})`;
  }

  drawPlate(fc, n, 1);

  // Ueberblendung nur bei linearer Fahrt. A(t+L) wird als zweite Zeichnung mit
  // fallender Deckkraft darueber gelegt — dieselbe Formel wie in ffmpeg, nur
  // ohne zweiten Eingang. Der Lichtfilter steht noch und gilt fuer beide
  // Zeichnungen gleichermassen, ist also aus der Ueberblendung herauskuerzbar.
  if (fc.presets.includes('pushin')) {
    const seamFrames = Math.max(2, Math.round(SEAM_CROSSFADE_SECONDS * DEFAULT_FPS));
    if (n < seamFrames) {
      drawPlate(fc, n + loopFrames, 1 - n / seamFrames);
    }
  }

  ctx.filter = 'none';

  // Staub kommt ungefiltert obendrauf und ist ueber die Loop-Laenge periodisch.
  if (fc.dust) {
    const { strip, tileH } = fc.dust;
    // Um GENAU eine Kachelhoehe scrollen: bei n=0 und n=loopFrames sitzt der
    // Streifen wieder exakt gleich.
    const shift = ((n % loopFrames) / loopFrames) * tileH;
    ctx.globalAlpha = STAUB_OPACITY;
    ctx.drawImage(strip, 0, -shift);
    ctx.globalAlpha = 1;
  }
}

// ─── Encoding ────────────────────────────────────────────────────────────────

export interface RenderProgress {
  format: MotionFormat;
  label: string;
  formatIndex: number;
  formatCount: number;
  frame: number;
  frameCount: number;
}

export interface RenderedClip {
  format: MotionFormat;
  label: string;
  width: number;
  height: number;
  duration: number;
  seconds: number;
  blob: Blob;
  url: string;
}

async function encodeFormat(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  fmt: MotionFormat,
  settings: MotionSettings,
  shortEdge: number,
  onFrame: (frame: number, total: number) => void,
  signal?: AbortSignal,
): Promise<RenderedClip> {
  const started = performance.now();
  const [outW, outH] = outputSize(fmt, shortEdge);
  const fps = DEFAULT_FPS;
  const loopFrames = Math.max(2, Math.round(settings.duration * fps));
  const presets = settings.presets;

  const codec = await pickCodec(outW, outH);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
  if (!ctx) throw new MotionRenderError('Canvas konnte nicht erzeugt werden.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const plate = buildCanvas(source, srcW, srcH, fmt, outW, outH, settings.bannerOffset);
  const dust = presets.includes('staub') ? buildDustStrip(outW, outH) : null;
  const fc: FrameContext = { canvas, ctx, plate, dust, presets, loopFrames, outW, outH };

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: outW, height: outH },
    fastStart: 'in-memory', // Damit das Video sofort abspielbar ist, nicht erst nach vollem Laden.
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  try {
    encoder.configure({
      codec,
      width: outW,
      height: outH,
      bitrate: Math.round(outW * outH * fps * 0.12),
      framerate: fps,
      latencyMode: 'quality',
    });
  } catch (e) {
    // Nie ungefangen lassen: ein Encoder, der beim Konfigurieren stirbt,
    // laesst `flush()` unten ewig warten — der Render haengt dann stumm.
    try { encoder.close(); } catch { /* schon zu */ }
    throw new MotionRenderError(
      `Der Videoencoder konnte für ${outW}×${outH} nicht eingerichtet werden.`,
      String(e),
    );
  }

  const frameDurationUs = Math.round(1_000_000 / fps);

  for (let n = 0; n < loopFrames; n++) {
    if (signal?.aborted) {
      encoder.close();
      throw new MotionRenderError('Abgebrochen.');
    }
    if (encodeError) throw new MotionRenderError('Das Video konnte nicht kodiert werden.', String(encodeError));

    renderFrame(fc, n);

    const videoFrame = new VideoFrame(canvas, {
      timestamp: n * frameDurationUs,
      duration: frameDurationUs,
    });
    // Alle zwei Sekunden ein Keyframe — sonst springt das Zurueckspulen im
    // Loop-Playback.
    encoder.encode(videoFrame, { keyFrame: n % (fps * 2) === 0 });
    videoFrame.close();

    onFrame(n + 1, loopFrames);

    // Regelmaessig an den Browser zurueckgeben: sonst friert die Oberflaeche
    // ein und der Fortschritt ist unsichtbar. Zusaetzlich Druck vom Encoder
    // nehmen, wenn seine Warteschlange volllaeuft.
    if (n % 8 === 0 || encoder.encodeQueueSize > 16) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      while (encoder.encodeQueueSize > 16 && !signal?.aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, 4));
      }
    }
  }

  await encoder.flush();
  encoder.close();
  if (encodeError) throw new MotionRenderError('Das Video konnte nicht kodiert werden.', String(encodeError));

  muxer.finalize();
  const buffer = (muxer.target as ArrayBufferTarget).buffer!;
  const blob = new Blob([buffer], { type: 'video/mp4' });

  return {
    format: fmt,
    label: FORMAT_LABEL[fmt],
    width: outW,
    height: outH,
    duration: settings.duration,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    blob,
    url: URL.createObjectURL(blob),
  };
}

// ─── Oeffentliche Schnittstelle ──────────────────────────────────────────────

export async function loadImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth < 320 || img.naturalHeight < 320) {
        reject(new MotionRenderError(
          `Der Flyer ist mit ${img.naturalWidth}×${img.naturalHeight} px zu klein für ein Video. ` +
          'Bitte lade das Original hoch, nicht die WhatsApp-Vorschau.',
        ));
        return;
      }
      resolve(img);
    };
    img.onerror = () => reject(new MotionRenderError(
      'Das Bild konnte nicht gelesen werden. Es ist möglicherweise unvollständig — ' +
      'das passiert oft bei Bildern aus dem WhatsApp-Cache. Bitte besorg dir das Original.',
    ));
    img.src = dataUri;
  });
}

export async function renderMotion(
  dataUri: string,
  settings: MotionSettings,
  options: {
    shortEdge?: number;
    onProgress?: (p: RenderProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<RenderedClip[]> {
  if (!isMotionSupported()) {
    throw new MotionRenderError(
      'Dein Browser unterstützt die Videoerzeugung nicht. Nimm bitte Chrome, Edge oder Safari 17+.',
    );
  }

  const shortEdge = options.shortEdge ?? DEFAULT_SHORT_EDGE;
  const img = await loadImage(dataUri);
  const clips: RenderedClip[] = [];

  for (let i = 0; i < settings.formats.length; i++) {
    const fmt = settings.formats[i];
    const clip = await encodeFormat(
      img, img.naturalWidth, img.naturalHeight, fmt, settings, shortEdge,
      (frame, frameCount) => options.onProgress?.({
        format: fmt,
        label: FORMAT_LABEL[fmt],
        formatIndex: i,
        formatCount: settings.formats.length,
        frame,
        frameCount,
      }),
      options.signal,
    );
    clips.push(clip);
  }

  return clips;
}

// ─── Qualitaetstor: die Naht messen ──────────────────────────────────────────

export interface SeamMeasurement {
  /** RMSE letzter Frame → erster Frame, 0..1. */
  seam: number;
  /** RMSE eines normalen Nachbarschritts derselben Phase. */
  reference: number;
  /** seam / reference. Unter 1 heißt: die Naht ist glatter als ein normaler Frameübergang. */
  ratio: number;
  passed: boolean;
}

/**
 * Obergrenze fuer das Verhaeltnis Naht zu Nachbarschritt.
 *
 * Bewusst NICHT „bit-genau null" als Kriterium: die ffmpeg-Fassung hat diesen
 * Wert erreicht, aber nur, weil `zoompan` die Bewegung am Zyklusanfang auf
 * ganze Pixel quantisiert und damit auf null gerundet hat — dort standen
 * mehrere Frames faelschlich still. Canvas loest diese Bewegung auf und
 * liefert deshalb einen kleinen Wert ungleich null. Das ist das bessere
 * Ergebnis, wuerde an einem Null-Kriterium aber durchfallen.
 *
 * Was zaehlt, ist der Vergleich mit einem normalen Frameuebergang.
 */
export const SEAM_RATIO_LIMIT = 1.3;

/** RMSE zweier gleich grosser ImageData, normiert auf 0..1. */
function rmse(a: ImageData, b: ImageData): number {
  let sum = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c];
      sum += d * d;
    }
  }
  return Math.sqrt(sum / ((n / 4) * 3)) / 255;
}

/**
 * Misst die Naht auf den ROHEN Frames, vor jeder Kodierung.
 *
 * Auf dem fertigen MP4 zu messen waere wertlos: Frame 0 ist ein Keyframe,
 * Frame N-1 ein P-Frame, und der Quantisierungsunterschied zwischen beiden ist
 * groesser als jeder echte Nahtfehler. In ffmpeg hat genau das die erste
 * Messreihe um den Faktor 17 bis 75 verfaelscht.
 *
 * Referenz ist bewusst der Schritt 1→2 und nicht die Bildmitte: die Naht liegt
 * am Zyklusanfang, und bei einer Cosinus-Fahrt steht die Bildmitte (Scheitel)
 * ebenfalls still — die Referenz waere exakt 0 und jedes Verhaeltnis
 * „unendlich".
 */
export async function measureSeam(
  dataUri: string,
  settings: MotionSettings,
  shortEdge = 480,
  fmt: MotionFormat = 'feed',
): Promise<SeamMeasurement> {
  const img = await loadImage(dataUri);
  const [outW, outH] = outputSize(fmt, shortEdge);
  const loopFrames = Math.max(2, Math.round(settings.duration * DEFAULT_FPS));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const plate = buildCanvas(img, img.naturalWidth, img.naturalHeight, fmt, outW, outH, settings.bannerOffset);
  const dust = settings.presets.includes('staub') ? buildDustStrip(outW, outH) : null;
  const fc: FrameContext = {
    canvas, ctx, plate, dust, presets: settings.presets, loopFrames, outW, outH,
  };

  const grab = (n: number): ImageData => {
    renderFrame(fc, n);
    return ctx.getImageData(0, 0, outW, outH);
  };

  const first = grab(0);
  const last = grab(loopFrames - 1);
  const one = grab(1);
  const two = grab(2);

  const seam = rmse(last, first);
  const reference = rmse(one, two);
  // Absoluter Boden, damit 0/0 kein „unendlich" ergibt. 0,002 entspricht ~0,5
  // Helligkeitsstufen von 255 und ist auf keinem Bildschirm sichtbar.
  const ratio = seam / Math.max(reference, 0.002);

  return { seam, reference, ratio, passed: ratio <= SEAM_RATIO_LIMIT };
}
