import { describe, it, expect } from 'vitest';
import {
  extendLottieDuration,
  extractLottieColors,
  remapLottieColors,
} from './LottieModifier';
import type { LottieAnimation } from '../models/LottieTypes';

/**
 * Build a minimal animation with a shape layer and one asset comp.
 * The shape layer has a red fill; the asset comp layer has a blue fill.
 */
function buildSampleAnimation(): LottieAnimation {
  return {
    v: '5.12.1',
    fr: 60,
    ip: 0,
    op: 221, // 3.68s
    w: 375,
    h: 820,
    nm: 'Sample',
    layers: [
      {
        ty: 4,
        nm: 'Root Shape',
        ind: 1,
        ip: 0,
        op: 100, // ends before comp op -> would blank out
        st: 0,
        ks: {
          p: { a: 0, k: [10, 20] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
        shapes: [
          {
            ty: 'gr',
            nm: 'Group',
            np: 2,
            it: [
              {
                ty: 'fl',
                nm: 'Fill',
                c: { a: 0, k: [1, 0, 0, 1] }, // red, opaque
                o: { a: 0, k: 100 },
              },
              {
                ty: 'st',
                nm: 'Stroke',
                c: { a: 0, k: [0, 0.5, 1, 0.5] }, // blue-ish, half alpha
                w: { a: 0, k: 2 },
                o: { a: 0, k: 100 },
              },
            ],
          },
        ],
      } as any,
      {
        ty: 0, // precomp
        nm: 'Nested Comp',
        ind: 2,
        refId: 'comp_1',
        ip: 0,
        op: 150,
        st: 0,
        ks: {
          p: { a: 0, k: [0, 0] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
      } as any,
    ],
    assets: [
      {
        id: 'comp_1',
        layers: [
          {
            ty: 4,
            nm: 'Nested Shape',
            ind: 1,
            ip: 0,
            op: 120,
            st: 0,
            ks: {
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [
              {
                ty: 'fl',
                nm: 'Nested Fill',
                c: { a: 0, k: [0, 0, 1, 1] }, // blue
                o: { a: 0, k: 100 },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('extendLottieDuration', () => {
  it('should extend comp op to target seconds converted to frames', () => {
    const source = buildSampleAnimation();
    const result = extendLottieDuration(source, 6);
    expect(result.json.op).toBe(360); // 6s * 60fps
    expect(result.newOp).toBe(360);
    expect(result.oldOp).toBe(221);
  });

  it('should extend layers alive at the end and leave early-vanished layers gone', () => {
    const source = buildSampleAnimation();
    // Make the precomp layer outlive the original end so it must hold the still frame
    source.layers[1].op = 300;
    const result = extendLottieDuration(source, 6);
    // Root shape vanished at frame 100 by design — extending it would change the design
    expect(result.json.layers[0].op).toBe(100);
    // The long-lived precomp layer (300) holds to the new end
    expect(result.json.layers[1].op).toBe(360);
    // The nested comp's last layer also holds (it is what the precomp displays)
    const comp = (result.json.assets || [])[0] as any;
    expect(comp.layers[0].op).toBe(360);
    expect(result.layersExtended).toBe(2);
  });

  it('should never shorten layers that already end after the new op', () => {
    const source = buildSampleAnimation();
    source.layers[0].op = 500; // already longer than the 6s target
    const result = extendLottieDuration(source, 6);
    expect(result.json.layers[0].op).toBe(500);
    expect(result.layersExtended).toBe(1); // only the nested comp layer
  });

  it('should never shorten the animation when target is below current duration', () => {
    const source = buildSampleAnimation();
    const result = extendLottieDuration(source, 1);
    expect(result.json.op).toBe(221);
    expect(result.layersExtended).toBe(0);
  });

  it('should not mutate the source JSON', () => {
    const source = buildSampleAnimation();
    const snapshot = JSON.stringify(source);
    extendLottieDuration(source, 6);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});

describe('extractLottieColors', () => {
  it('should collect unique fill and stroke colors from root and nested comps with counts', () => {
    const source = buildSampleAnimation();
    const colors = extractLottieColors(source);
    const hexes = colors.map((c) => c.hex);
    expect(hexes).toContain('#ff0000');
    expect(hexes).toContain('#0080ff');
    expect(hexes).toContain('#0000ff');
    // stable ordering: by usage count descending
    expect(colors.every((c, i) => i === 0 || colors[i - 1].count >= c.count)).toBe(true);
  });

  it('should return an empty list when there are no vector colors', () => {
    const source = buildSampleAnimation();
    source.layers = source.layers.filter((l) => l.ty !== 4);
    (source.assets || []).forEach((a) => {
      if ((a as any).layers) (a as any).layers = (a as any).layers.filter((l: any) => l.ty !== 4);
    });
    expect(extractLottieColors(source)).toEqual([]);
  });
});

describe('remapLottieColors', () => {
  it('should replace matching colors in root and nested layers and keep alpha', () => {
    const source = buildSampleAnimation();
    const result = remapLottieColors(source, { r: 1, g: 0, b: 0 }, { r: 0, g: 1, b: 0 });
    expect(result.replaced).toBe(1);
    const fill = (result.json.layers[0] as any).shapes[0].it[0].c.k;
    expect(fill[0]).toBe(0); // r
    expect(fill[1]).toBe(1); // g
    expect(fill[3]).toBe(1); // alpha preserved
  });

  it('should replace matching colors inside asset comps', () => {
    const source = buildSampleAnimation();
    const result = remapLottieColors(source, { r: 0, g: 0, b: 1 }, { r: 1, g: 1, b: 0 });
    expect(result.replaced).toBe(1);
    const comp = (result.json.assets || [])[0] as any;
    expect(comp.layers[0].shapes[0].c.k).toEqual([1, 1, 0, 1]);
  });

  it('should report zero replacements when the color is not present', () => {
    const source = buildSampleAnimation();
    const result = remapLottieColors(source, { r: 0.5, g: 0.5, b: 0.5 }, { r: 0, g: 0, b: 0 });
    expect(result.replaced).toBe(0);
  });

  it('should not mutate the source JSON', () => {
    const source = buildSampleAnimation();
    const snapshot = JSON.stringify(source);
    remapLottieColors(source, { r: 1, g: 0, b: 0 }, { r: 0, g: 1, b: 0 });
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});
