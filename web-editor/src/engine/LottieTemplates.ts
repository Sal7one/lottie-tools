import type { LottieAnimation, LottieAnimatedProperty } from '../models/LottieTypes';
import { extendLottieDuration, walkAllLayers, walkColorProps } from './LottieModifier';

/**
 * LottieTemplates - One-click workflows composed from pure JSON transforms.
 * Every template takes the raw imported document and returns a new one.
 */

export interface TemplateResult {
  json: LottieAnimation;
  summary: string;
}

export interface LottieTemplate {
  id: string;
  emoji: string;
  label: string;
  description: string;
  apply: (source: LottieAnimation) => TemplateResult;
}

const ROOT_KEYS = ['v', 'fr', 'ip', 'op', 'w', 'h', 'nm', 'ddd', 'assets', 'layers'];

/** Yield every keyframe array of animated properties in a layer (transform + shape props) */
function* walkKeyframeArrays(layer: any): Generator<LottieAnimatedProperty[]> {
  const props = Object.values(layer.ks || {});
  for (const p of props) {
    if (p && (p as any).a === 1 && Array.isArray((p as any).k)) yield p as any;
  }
  const shapes = layer.shapes as any[] | undefined;
  if (!shapes) return;
  for (const item of shapes) {
    if (item.ty === 'gr' && Array.isArray(item.it)) {
      for (const sub of item.it) {
        for (const key of ['p', 'a', 's', 'r', 'o', 'c', 'w']) {
          const p = sub[key];
          if (p && p.a === 1 && Array.isArray(p.k)) yield p;
        }
      }
    }
  }
}

function* walkKeyframeArraysAllLayers(json: LottieAnimation) {
  for (const layer of walkAllLayers(json)) {
    yield* walkKeyframeArrays(layer);
  }
}

/** Change playback speed by rescaling the whole timeline (keyframes, in/out points) */
export function rescaleLottieTime(source: LottieAnimation, factor: number): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  json.ip = Math.round(json.ip * factor);
  json.op = Math.max(1, Math.round(json.op * factor));
  for (const layer of walkAllLayers(json)) {
    layer.ip = Math.round(layer.ip * factor);
    layer.op = Math.round(layer.op * factor);
    layer.st = (layer.st ?? 0) * factor;
  }
  for (const prop of walkKeyframeArraysAllLayers(json)) {
    for (const kf of prop.k as any[]) {
      if (typeof kf.t === 'number') kf.t *= factor;
    }
  }
  return { json, summary: `timeline rescaled by ${factor}x (${(json.op / json.fr).toFixed(2)}s)` };
}

/** Hold the first frame for a delay before the animation starts */
export function delayLottieStart(source: LottieAnimation, seconds: number): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  const frames = Math.round(seconds * json.fr);
  json.ip += frames;
  json.op += frames;
  for (const layer of walkAllLayers(json)) {
    layer.ip += frames;
    layer.op += frames;
    layer.st = (layer.st ?? 0) + frames;
  }
  for (const prop of walkKeyframeArraysAllLayers(json)) {
    for (const kf of prop.k as any[]) {
      if (typeof kf.t === 'number') kf.t += frames;
    }
  }
  return { json, summary: `first frame held for ${seconds}s before animating` };
}

/** Fade every visible root layer to transparent over the last `seconds` */
export function addFadeOut(source: LottieAnimation, seconds: number): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  const frames = Math.max(1, Math.round(seconds * json.fr));
  const start = Math.max(0, json.op - frames);
  let faded = 0;

  for (const layer of json.layers || []) {
    if ((layer.op ?? 0) < json.op) continue; // only layers alive at the end
    const o: any = (layer.ks as any)?.o;
    if (!o) continue;
    if (o.a === 0) {
      const v = o.k;
      o.a = 1;
      o.k = [
        { t: start, s: [v], i: { x: [0.667], y: [1] }, o: { x: [0.333], y: [0] } },
        { t: json.op, s: [0] },
      ];
      faded++;
    } else if (Array.isArray(o.k) && o.k.length > 0) {
      const last = o.k[o.k.length - 1];
      const lastVal = Array.isArray(last.s) ? last.s[0] : last.s;
      o.k.push({ t: start, s: [lastVal] });
      o.k.push({ t: json.op, s: [0] });
      faded++;
    }
  }
  return { json, summary: `fade-out added on ${faded} layer${faded === 1 ? '' : 's'} over the last ${seconds}s` };
}

/** Clamp layers whose in/out points overrun their composition (native player stalls) */
export function clampLayerTiming(source: LottieAnimation): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  let clamped = 0;

  for (const layer of json.layers || []) {
    if (layer.op > json.op) { layer.op = json.op; clamped++; }
    if (layer.ip < json.ip) { layer.ip = json.ip; clamped++; }
  }
  for (const asset of json.assets || []) {
    const layers = (asset as any).layers as any[] | undefined;
    if (!layers || layers.length === 0) continue;
    const compEnd = Math.max(...layers.map((l) => l.op ?? 0));
    const compStart = Math.min(...layers.map((l) => l.ip ?? 0));
    for (const layer of layers) {
      if (layer.op > compEnd) { layer.op = compEnd; clamped++; }
      if (layer.ip < compStart) { layer.ip = compStart; clamped++; }
    }
  }
  return { json, summary: `${clamped} layer timing overrun${clamped === 1 ? '' : 's'} clamped` };
}

/** Remove non-standard top-level keys some exporters add (props, markers, meta...) */
export function stripNonStandardKeys(source: LottieAnimation): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  let stripped = 0;
  for (const key of Object.keys(json as any)) {
    if (!ROOT_KEYS.includes(key)) {
      delete (json as any)[key];
      stripped++;
    }
  }
  return { json, summary: stripped === 0 ? 'nothing to strip' : `${stripped} non-standard key${stripped === 1 ? '' : 's'} removed` };
}

/** Replace NaN / Infinity values with 0 */
export function cleanupInvalidNumbers(source: LottieAnimation): TemplateResult {
  let fixed = 0;
  const fix = (obj: any): any => {
    if (Array.isArray(obj)) return obj.map(fix);
    if (obj && typeof obj === 'object') {
      const out: any = {};
      for (const key of Object.keys(obj)) out[key] = fix(obj[key]);
      return out;
    }
    if (typeof obj === 'number' && !Number.isFinite(obj)) {
      fixed++;
      return 0;
    }
    return obj;
  };
  const json = fix(structuredClone(source));
  return {
    json,
    summary: fixed === 0 ? 'no invalid numbers found' : `${fixed} invalid number${fixed === 1 ? '' : 's'} replaced with 0`,
  };
}

export function invertLottieColors(source: LottieAnimation): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  let count = 0;
  for (const c of walkColorProps(json)) {
    c[0] = 1 - c[0]; c[1] = 1 - c[1]; c[2] = 1 - c[2];
    count++;
  }
  return { json, summary: count === 0 ? 'no vector colors to invert' : `${count} vector color${count === 1 ? '' : 's'} inverted` };
}

export function grayscaleLottieColors(source: LottieAnimation): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  let count = 0;
  for (const c of walkColorProps(json)) {
    const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    c[0] = lum; c[1] = lum; c[2] = lum;
    count++;
  }
  return { json, summary: count === 0 ? 'no vector colors to desaturate' : `${count} vector color${count === 1 ? '' : 's'} desaturated` };
}

/** Blend all vector colors toward a target color (0 = unchanged, 1 = solid target) */
export function tintLottieColors(
  source: LottieAnimation,
  target: { r: number; g: number; b: number },
  strength: number
): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  let count = 0;
  for (const c of walkColorProps(json)) {
    c[0] = c[0] * (1 - strength) + target.r * strength;
    c[1] = c[1] * (1 - strength) + target.g * strength;
    c[2] = c[2] * (1 - strength) + target.b * strength;
    count++;
  }
  return { json, summary: `${count} vector color${count === 1 ? '' : 's'} tinted (${Math.round(strength * 100)}%)` };
}

/** Forward-then-reverse playback so the animation loops seamlessly */
export function boomerangLottie(source: LottieAnimation): TemplateResult {
  const json: LottieAnimation = structuredClone(source);
  const op = json.op;
  let layersLooped = 0;

  for (const layer of json.layers || []) {
    if ((layer.op ?? 0) < op) continue;
    for (const prop of walkKeyframeArrays(layer)) {
      const kfs = prop.k as any[];
      const forward = kfs.filter((kf) => typeof kf.t === 'number' && kf.t <= op);
      const mirror = forward
        .slice(0, -1)
        .reverse()
        .map((kf) => ({ ...kf, t: 2 * op - kf.t }));
      kfs.push(...mirror);
    }
    layer.op = 2 * op;
    layersLooped++;
  }
  json.op = 2 * op;
  return { json, summary: `boomerang loop built from ${layersLooped} layer${layersLooped === 1 ? '' : 's'} (${(json.op / json.fr).toFixed(2)}s)` };
}

export const TEMPLATES: LottieTemplate[] = [
  {
    id: 'extend-hold',
    emoji: '🧘',
    label: 'Extend & Hold 6s',
    description: 'Extend to 6 seconds, holding the final frame — the classic trick for picky native players.',
    apply: (s) => {
      const r = extendLottieDuration(s, 6);
      return { json: r.json, summary: `extended to ${(r.newOp / s.fr).toFixed(1)}s, ${r.layersExtended} layers hold` };
    },
  },
  {
    id: 'slow-mo',
    emoji: '🐢',
    label: 'Slow Motion',
    description: 'Half-speed playback by doubling the whole timeline.',
    apply: (s) => rescaleLottieTime(s, 2),
  },
  {
    id: 'fast-forward',
    emoji: '🐇',
    label: 'Fast Forward',
    description: 'Double-speed playback by halving the whole timeline.',
    apply: (s) => rescaleLottieTime(s, 0.5),
  },
  {
    id: 'intro-delay',
    emoji: '⏱️',
    label: 'Intro Delay 1s',
    description: 'Hold the first frame for 1 second before the animation starts.',
    apply: (s) => delayLottieStart(s, 1),
  },
  {
    id: 'fade-out',
    emoji: '🌗',
    label: 'Fade Out Ending',
    description: 'Gracefully fade all visible layers to transparent over the final 0.8s.',
    apply: (s) => addFadeOut(s, 0.8),
  },
  {
    id: 'safe-mode',
    emoji: '🛡️',
    label: 'Native Safe Mode',
    description: 'Clamp layers that overrun their composition and strip non-standard keys — targets Android/iOS stalls.',
    apply: (s) => {
      const a = clampLayerTiming(s);
      const b = stripNonStandardKeys(a.json);
      return { json: b.json, summary: `${a.summary}; ${b.summary}` };
    },
  },
  {
    id: 'clean-export',
    emoji: '🧹',
    label: 'Clean Export',
    description: 'Strip non-standard keys and replace NaN/Infinity values with 0.',
    apply: (s) => {
      const a = stripNonStandardKeys(s);
      const b = cleanupInvalidNumbers(a.json);
      return { json: b.json, summary: `${a.summary}; ${b.summary}` };
    },
  },
  {
    id: 'invert-colors',
    emoji: '🌈',
    label: 'Invert Colors',
    description: 'Invert every vector fill/stroke — a quick dark↔light feel for vector art.',
    apply: (s) => invertLottieColors(s),
  },
  {
    id: 'grayscale',
    emoji: '🌑',
    label: 'Grayscale Vectors',
    description: 'Desaturate all vector colors to luminance gray.',
    apply: (s) => grayscaleLottieColors(s),
  },
  {
    id: 'boomerang',
    emoji: '↩️',
    label: 'Boomerang Loop',
    description: 'Play forward then reversed for a seamless ping-pong loop.',
    apply: (s) => boomerangLottie(s),
  },
];
