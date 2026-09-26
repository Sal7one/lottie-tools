import { describe, it, expect } from 'vitest';
import { LottieImporter } from './LottieImporter';
import type { LottieAnimation } from '../models/LottieTypes';

describe('LottieImporter', () => {
  describe('Basic Import Structure', () => {
    it('should reject invalid JSON structure', () => {
      const result = LottieImporter.importFromLottie({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject Lottie without required fields', () => {
      const invalidLottie = { v: '5.5.7' } as any;
      const result = LottieImporter.importFromLottie(invalidLottie);
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should accept minimal valid Lottie', () => {
      const validLottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [],
      };
      const result = LottieImporter.importFromLottie(validLottie);
      expect(result.success).toBe(true);
      expect(result.project).toBeDefined();
    });
  });

  describe('Project Settings Extraction', () => {
    it('should extract width and height', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 1920,
        h: 1080,
        layers: [],
      };
      const result = LottieImporter.importFromLottie(lottie);
      expect(result.project?.width).toBe(1920);
      expect(result.project?.height).toBe(1080);
    });

    it('should extract frame rate', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 60,
        ip: 0,
        op: 120,
        w: 512,
        h: 512,
        layers: [],
      };
      const result = LottieImporter.importFromLottie(lottie);
      expect(result.project?.fps).toBe(60);
    });

    it('should calculate duration from frames', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 90, // 90 frames at 30fps = 3 seconds
        w: 512,
        h: 512,
        layers: [],
      };
      const result = LottieImporter.importFromLottie(lottie);
      expect(result.project?.duration).toBe(3);
    });

    it('should extract animation name if present', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        nm: 'My Animation',
        layers: [],
      };
      const result = LottieImporter.importFromLottie(lottie);
      expect(result.project?.name).toBe('My Animation');
    });
  });

  describe('Raw Source Preservation', () => {
    it('should preserve the original Lottie JSON on the project for preview', () => {
      const lottie: LottieAnimation = {
        v: '5.12.1',
        fr: 60,
        ip: 0,
        op: 221,
        w: 375,
        h: 820,
        nm: 'Original Raw Animation',
        assets: [{ id: 'image_0', w: 105, h: 138, u: '', p: 'data:image/png;base64,AAA' }],
        layers: [],
      };
      const result = LottieImporter.importFromLottie(lottie);
      expect(result.success).toBe(true);
      expect(result.project?.sourceLottieJson).toBe(lottie);
      // Embedded assets must survive untouched so the preview can render images
      expect(result.project?.sourceLottieJson?.assets).toHaveLength(1);
    });
  });

  describe('Layer Conversion', () => {
    it('should import shape layer', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4, // Shape layer
            nm: 'Rectangle',
            ind: 1,
            ks: {
              p: { a: 0, k: [256, 256] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      expect(result.project?.layers).toHaveLength(1);
      expect(result.project?.layers[0].name).toBe('Rectangle');
    });

    it('should skip unsupported layer types with warning', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 5, // Text layer (unsupported)
            nm: 'Text Layer',
            ind: 1,
            ks: {} as any,
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.some(w => w.includes('Text'))).toBe(true);
      expect(result.project?.layers).toHaveLength(0);
    });

    it('should preserve layer order', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer 1',
            ind: 1,
            ks: {} as any,
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
          {
            ty: 4,
            nm: 'Layer 2',
            ind: 2,
            ks: {} as any,
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      expect(result.project?.layers[0].name).toBe('Layer 1');
      expect(result.project?.layers[1].name).toBe('Layer 2');
    });
  });

  describe('Transform Conversion', () => {
    it('should extract static position', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer',
            ind: 1,
            ks: {
              p: { a: 0, k: [100, 200] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const layer = result.project?.layers[0];
      expect(layer?.element.transform.x).toBe(100);
      expect(layer?.element.transform.y).toBe(200);
    });

    it('should convert scale from percentage to multiplier', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer',
            ind: 1,
            ks: {
              p: { a: 0, k: [256, 256] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [200, 150] }, // 200%, 150%
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const layer = result.project?.layers[0];
      expect(layer?.element.transform.scaleX).toBe(2.0);
      expect(layer?.element.transform.scaleY).toBe(1.5);
    });

    it('should convert opacity from 0-100 to 0-1', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer',
            ind: 1,
            ks: {
              p: { a: 0, k: [256, 256] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 50 }, // 50%
            },
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const layer = result.project?.layers[0];
      expect(layer?.element.style.opacity).toBe(0.5);
    });

    it('should preserve rotation in degrees', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer',
            ind: 1,
            ks: {
              p: { a: 0, k: [256, 256] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 45 },
              o: { a: 0, k: 100 },
            },
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const layer = result.project?.layers[0];
      expect(layer?.element.transform.rotation).toBe(45);
    });
  });

  describe('Keyframe Extraction', () => {
    it('should extract animated position keyframes', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer',
            ind: 1,
            ks: {
              p: {
                a: 1,
                k: [
                  { t: 0, s: [100, 100], e: [200, 200], i: { x: [1], y: [1] }, o: { x: [0], y: [0] } },
                  { t: 30, s: [200, 200] },
                ],
              },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const keyframes = result.project?.keyframes || [];
      const xKeyframes = keyframes.filter(kf => kf.property === 'x');
      const yKeyframes = keyframes.filter(kf => kf.property === 'y');

      expect(xKeyframes).toHaveLength(2);
      expect(yKeyframes).toHaveLength(2);
      expect(xKeyframes[0].time).toBe(0);
      expect(xKeyframes[1].time).toBe(1); // 30 frames / 30 fps = 1 second
    });

    it('should preserve custom bezier tangents', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer',
            ind: 1,
            ks: {
              p: {
                a: 1,
                k: [
                  {
                    t: 0,
                    s: [100, 100],
                    e: [200, 200],
                    i: { x: [0.58], y: [0.8] },
                    o: { x: [0.42], y: [0.2] }
                  },
                  { t: 30, s: [200, 200] },
                ],
              },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const keyframes = result.project?.keyframes || [];
      const xKeyframes = keyframes.filter(kf => kf.property === 'x');

      expect(xKeyframes[0].easing).toBe('custom');
      expect(xKeyframes[0].easingBezier).toBeDefined();
      expect(xKeyframes[0].easingBezier?.o.x[0]).toBe(0.42);
      expect(xKeyframes[0].easingBezier?.o.y[0]).toBe(0.2);
    });

    it('should handle hold keyframes', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer',
            ind: 1,
            ks: {
              p: {
                a: 1,
                k: [
                  { t: 0, s: [100, 100], h: 1 },
                  { t: 30, s: [200, 200] },
                ],
              },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const keyframes = result.project?.keyframes || [];
      const xKeyframes = keyframes.filter(kf => kf.property === 'x');

      expect(xKeyframes[0].easing).toBe('hold');
    });
  });

  describe('Shape Conversion', () => {
    it('should convert rect shape to internal format', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Rectangle Layer',
            ind: 1,
            ks: {
              p: { a: 0, k: [256, 256] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [
              {
                ty: 'rc',
                nm: 'Rectangle',
                p: { a: 0, k: [0, 0] },
                s: { a: 0, k: [100, 50] },
                r: { a: 0, k: 0 },
              },
            ],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const layer = result.project?.layers[0];
      expect(layer?.element.type).toBe('rect');
    });

    it('should convert ellipse shape to internal format', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Ellipse Layer',
            ind: 1,
            ks: {
              p: { a: 0, k: [256, 256] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
            shapes: [
              {
                ty: 'el',
                nm: 'Ellipse',
                p: { a: 0, k: [0, 0] },
                s: { a: 0, k: [100, 100] },
              },
            ],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      const layer = result.project?.layers[0];
      expect(layer?.element.type).toBe('ellipse');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing layer data gracefully', () => {
      const lottie: LottieAnimation = {
        v: '5.5.7',
        fr: 30,
        ip: 0,
        op: 60,
        w: 512,
        h: 512,
        layers: [
          {
            ty: 4,
            nm: 'Layer',
            ind: 1,
            ks: null as any, // Missing transform
            shapes: [],
            ip: 0,
            op: 60,
            st: 0,
          },
        ],
      };
      const result = LottieImporter.importFromLottie(lottie);
      // Should not crash, might skip layer with warning
      expect(result.success).toBe(true);
    });

    it('should provide meaningful error messages', () => {
      const result = LottieImporter.importFromLottie(null as any);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(typeof result.error).toBe('string');
    });
  });
});
