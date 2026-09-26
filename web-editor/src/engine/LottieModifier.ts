import type { LottieAnimation, LottieLayer } from '../models/LottieTypes';

/**
 * LottieModifier - Pure transformations applied to raw imported Lottie JSON.
 *
 * These operate directly on the source document (including precomp assets),
 * because the editor's layer model can't represent everything a Lottie file
 * contains. All functions deep-clone their input and never mutate it.
 */

export interface ExtendDurationResult {
  json: LottieAnimation;
  oldOp: number;
  newOp: number;
  /** How many layers (root + asset comps) had their out-point pushed forward */
  layersExtended: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface LottieColorInfo extends RGB {
  hex: string;
  /** How many fill/stroke properties use this color */
  count: number;
}

export interface RemapColorsResult {
  json: LottieAnimation;
  replaced: number;
}

/**
 * Collect every layer in the document: root composition layers plus the
 * layers of every precomp asset. Lottie nests precomps only through the
 * assets map, so walking root + assets covers the whole tree.
 */
export function* walkAllLayers(json: LottieAnimation): Generator<LottieLayer> {
  for (const layer of json.layers || []) {
    yield layer as LottieLayer;
  }
  for (const asset of json.assets || []) {
    for (const layer of ((asset as any).layers || []) as LottieLayer[]) {
      yield layer;
    }
  }
}

/**
 * Extend the animation duration to at least targetSeconds, producing a
 * still frame of the final designed frame. The comp out-point moves to the
 * new end, and layers that are still alive at the old end are extended so
 * they hold instead of vanishing. Layers that already vanished earlier are
 * left alone — disappearing at their out-point is part of the design.
 * Animated properties hold their last keyframe value past its end, which is
 * standard Lottie behavior in lottie-web and lottie-android.
 */
export function extendLottieDuration(
  source: LottieAnimation,
  targetSeconds: number
): ExtendDurationResult {
  const json: LottieAnimation = structuredClone(source);
  const oldOp = json.op;
  const newOp = Math.max(Math.round(targetSeconds * json.fr), oldOp);
  let layersExtended = 0;

  if (newOp > oldOp) {
    for (const layer of json.layers || []) {
      if (layer.op >= oldOp && layer.op < newOp) {
        layer.op = newOp;
        layersExtended++;
      }
    }
    for (const asset of json.assets || []) {
      const layers = (asset as any).layers as LottieLayer[] | undefined;
      if (!layers || layers.length === 0) continue;
      // The comp's designed end is its last layer out-point; layers alive at
      // that moment are the ones that must hold for the still frame.
      const compEnd = Math.max(...layers.map((l) => l.op ?? 0));
      for (const layer of layers) {
        if (layer.op >= compEnd && layer.op < newOp) {
          layer.op = newOp;
          layersExtended++;
        }
      }
    }
    json.op = newOp;
  }

  return { json, oldOp, newOp, layersExtended };
}

export function* walkColorProps(json: LottieAnimation): Generator<number[]> {
  for (const layer of walkAllLayers(json)) {
    const shapes = (layer as any).shapes as any[] | undefined;
    if (!shapes) continue;
    yield* walkShapeItems(shapes);
  }
}

function* walkShapeItems(items: any[]): Generator<number[]> {
  for (const item of items) {
    if (item.ty === 'gr' && Array.isArray(item.it)) {
      yield* walkShapeItems(item.it);
    } else if (
      (item.ty === 'fl' || item.ty === 'st') &&
      item.c &&
      item.c.a === 0 && // static colors only; animated ones can't be remapped safely
      Array.isArray(item.c.k)
    ) {
      yield item.c.k;
    }
  }
}

function toHex({ r, g, b }: RGB): string {
  const ch = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/**
 * List the distinct vector colors used by fills and strokes, most used first.
 * Colors baked into raster image assets can't be listed or changed here.
 */
export function extractLottieColors(source: LottieAnimation): LottieColorInfo[] {
  const counts = new Map<string, { rgb: RGB; count: number }>();

  for (const c of walkColorProps(source)) {
    const [r, g, b] = c;
    const hex = toHex({ r, g, b });
    const entry = counts.get(hex);
    if (entry) {
      entry.count++;
    } else {
      counts.set(hex, { rgb: { r, g, b }, count: 1 });
    }
  }

  return [...counts.values()]
    .map(({ rgb, count }) => ({ ...rgb, hex: toHex(rgb), count }))
    .sort((a, b) => b.count - a.count);
}

const COLOR_TOLERANCE = 1 / 255 + 1e-9;

/**
 * Replace one vector color with another everywhere in the document
 * (root layers + precomp assets). Alpha channels are preserved.
 */
export function remapLottieColors(
  source: LottieAnimation,
  from: RGB,
  to: RGB
): RemapColorsResult {
  const json: LottieAnimation = structuredClone(source);
  let replaced = 0;

  for (const c of walkColorProps(json)) {
    const [r, g, b] = c;
    if (
      Math.abs(r - from.r) <= COLOR_TOLERANCE &&
      Math.abs(g - from.g) <= COLOR_TOLERANCE &&
      Math.abs(b - from.b) <= COLOR_TOLERANCE
    ) {
      c[0] = to.r;
      c[1] = to.g;
      c[2] = to.b; // alpha in c[3] is left untouched
      replaced++;
    }
  }

  return { json, replaced };
}
