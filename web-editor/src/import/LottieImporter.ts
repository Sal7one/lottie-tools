import type { LottieAnimation, LottieLayer, LottieShapeLayer, LottieAnimatedProperty, LottieKeyframe } from '../models/LottieTypes';
import type { ProjectState } from '../store/useStore';
import type { Layer } from '../models/Layer';
import type { Keyframe, BezierTangents } from '../models/Keyframe';
import type { AnyElement } from '../models/Element';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export interface ImportResult {
  success: boolean;
  project?: ProjectState;
  error?: string;
  warnings?: string[];
}

export class LottieImporter {
  /**
   * Import a Lottie JSON animation into internal project format
   */
  static importFromLottie(lottie: LottieAnimation): ImportResult {
    const warnings: string[] = [];

    try {
      // Validate Lottie structure
      const validationError = this.validateLottie(lottie);
      if (validationError) {
        return { success: false, error: validationError };
      }

      // Extract project settings
      const fps = lottie.fr;
      const duration = (lottie.op - lottie.ip) / fps;

      // Convert layers and collect keyframes
      const layers: Layer[] = [];
      const allKeyframes: Keyframe[] = [];

      for (const lottieLayer of lottie.layers || []) {
        const result = this.convertLayer(lottieLayer, fps);
        if (result.layer) {
          layers.push(result.layer);
          allKeyframes.push(...result.keyframes);
        }
        if (result.warning) {
          warnings.push(result.warning);
        }
      }

      // Create project state
      const project: ProjectState = {
        name: lottie.nm || 'Imported Animation',
        width: lottie.w,
        height: lottie.h,
        fps: lottie.fr,
        duration,
        loop: false,
        currentTime: 0,
        isPlaying: false,
        layers,
        keyframes: allKeyframes,
        selectedLayerIds: [],
        sourceLottieJson: lottie,
        originalLottieJson: structuredClone(lottie),
      };

      return {
        success: true,
        project,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown import error',
      };
    }
  }

  /**
   * Validate Lottie JSON structure
   */
  private static validateLottie(lottie: any): string | null {
    if (!lottie) {
      return 'Invalid Lottie: null or undefined';
    }

    const required = ['v', 'fr', 'ip', 'op', 'w', 'h'];
    for (const field of required) {
      if (!(field in lottie)) {
        return `Invalid Lottie: missing required field "${field}"`;
      }
    }

    return null;
  }

  /**
   * Convert a Lottie layer to internal format
   */
  private static convertLayer(
    lottieLayer: LottieLayer,
    fps: number
  ): { layer?: Layer; keyframes: Keyframe[]; warning?: string } {
    // Only support shape layers (ty: 4)
    if (lottieLayer.ty !== 4) {
      const layerTypes: Record<number, string> = {
        0: 'Precomp',
        1: 'Solid',
        2: 'Image',
        3: 'Null',
        5: 'Text',
        6: 'Audio',
        7: 'Video Placeholder',
        9: 'Image Sequence',
        13: 'Camera',
        14: 'Light',
      };
      const typeName = layerTypes[lottieLayer.ty] || `Type ${lottieLayer.ty}`;
      return {
        keyframes: [],
        warning: `Skipped unsupported layer type: ${typeName} (${lottieLayer.nm})`,
      };
    }

    const shapeLayer = lottieLayer as LottieShapeLayer;

    // Create base element
    const layerId = generateId();
    const elementId = generateId();

    // Extract transform
    const ks = shapeLayer.ks;
    if (!ks) {
      return { keyframes: [], warning: `Skipped layer with missing transform: ${shapeLayer.nm}` };
    }

    // Get static transform values
    const position = this.getStaticValue(ks.p, [0, 0]) as [number, number];
    const anchor = this.getStaticValue(ks.a, [0, 0]) as [number, number];
    const scale = this.getStaticValue(ks.s, [100, 100]) as [number, number];
    const rotation = this.getStaticValue(ks.r, 0) as number;
    const opacity = this.getStaticValue(ks.o, 100) as number;

    // Convert shapes (use first shape for now, simplified)
    const element: AnyElement = this.convertShapes(shapeLayer.shapes || [], elementId);

    // Apply transform (handle anchor point offset)
    element.transform = {
      x: position[0] - anchor[0],
      y: position[1] - anchor[1],
      scaleX: scale[0] / 100,
      scaleY: scale[1] / 100,
      rotation,
    };

    element.style = {
      ...element.style,
      opacity: opacity / 100,
    };

    // Extract keyframes from transform
    const keyframes = this.extractKeyframes(ks, layerId, fps);

    // Extract keyframes from shape properties (fill, stroke)
    const shapeKeyframes = this.extractShapeKeyframes(shapeLayer.shapes || [], layerId, fps);
    keyframes.push(...shapeKeyframes);

    const layer: Layer = {
      id: layerId,
      name: shapeLayer.nm,
      element,
      visible: true,
      locked: false,
    };

    return { layer, keyframes };
  }

  /**
   * Get static value from animated property
   */
  private static getStaticValue(prop: LottieAnimatedProperty | undefined, defaultValue: any): any {
    if (!prop) return defaultValue;
    if (prop.a === 0) return prop.k;
    if (prop.a === 1 && Array.isArray(prop.k) && prop.k.length > 0) {
      return (prop.k as LottieKeyframe[])[0].s;
    }
    return defaultValue;
  }

  /**
   * Convert Lottie shapes to internal element
   */
  private static convertShapes(shapes: any[], elementId: string): AnyElement {
    // Extract fill and stroke from shapes array (or nested groups)
    let fill = 'none';
    let stroke = 'none';
    let strokeWidth = 0;

    // Helper to extract styles from shape items
    const extractStyles = (items: any[]) => {
      for (const item of items) {
        if (item.ty === 'fl') {
          // Fill
          const color = this.getStaticValue(item.c, [0, 0, 0]);
          if (Array.isArray(color) && color.length >= 3) {
            fill = this.rgbArrayToHex(color[0], color[1], color[2]);
          }
        } else if (item.ty === 'st') {
          // Stroke
          const color = this.getStaticValue(item.c, [0, 0, 0]);
          if (Array.isArray(color) && color.length >= 3) {
            stroke = this.rgbArrayToHex(color[0], color[1], color[2]);
          }
          strokeWidth = this.getStaticValue(item.w, 1);
        } else if (item.ty === 'gr' && item.it) {
          // Nested group - recurse
          extractStyles(item.it);
        }
      }
    };

    extractStyles(shapes);

    // Find first shape geometry (rect, ellipse, or path)
    const findShape = (items: any[]): AnyElement | null => {
      for (const shape of items) {
        if (shape.ty === 'gr' && shape.it) {
          // Group - recurse into items
          const found = findShape(shape.it);
          if (found) return found;
        } else if (shape.ty === 'rc') {
          // Rectangle
          const size = this.getStaticValue(shape.s, [100, 100]) as [number, number];
          const position = this.getStaticValue(shape.p, [0, 0]) as [number, number];
          return {
            id: elementId,
            type: 'rect',
            name: shape.nm || 'Rectangle',
            transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
            style: { fill, stroke, strokeWidth, opacity: 1 },
            x: position[0] - size[0] / 2,
            y: position[1] - size[1] / 2,
            width: size[0],
            height: size[1],
          };
        } else if (shape.ty === 'el') {
          // Ellipse
          const size = this.getStaticValue(shape.s, [100, 100]) as [number, number];
          const position = this.getStaticValue(shape.p, [0, 0]) as [number, number];
          return {
            id: elementId,
            type: 'ellipse',
            name: shape.nm || 'Ellipse',
            transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
            style: { fill, stroke, strokeWidth, opacity: 1 },
            cx: position[0],
            cy: position[1],
            rx: size[0] / 2,
            ry: size[1] / 2,
          };
        } else if (shape.ty === 'sh') {
          // Path shape
          const pathData = this.getStaticValue(shape.ks, {});
          const d = this.lottiePathToSVG(pathData);
          return {
            id: elementId,
            type: 'path',
            name: shape.nm || 'Path',
            transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
            style: { fill, stroke, strokeWidth, opacity: 1 },
            d,
          };
        }
      }
      return null;
    };

    const element = findShape(shapes);
    if (element) return element;

    // Default: simple circle at center
    return {
      id: elementId,
      type: 'circle',
      name: 'Shape',
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      style: { fill, stroke, strokeWidth, opacity: 1 },
      cx: 0,
      cy: 0,
      r: 50,
    };
  }

  /**
   * Convert Lottie path format to SVG path string
   */
  private static lottiePathToSVG(pathData: any): string {
    if (!pathData.v || !Array.isArray(pathData.v)) {
      return 'M 0 0'; // Default empty path
    }

    const vertices = pathData.v;
    const inTangents = pathData.i || [];
    const outTangents = pathData.o || [];
    const closed = pathData.c || false;

    let d = '';

    for (let i = 0; i < vertices.length; i++) {
      const [x, y] = vertices[i];

      if (i === 0) {
        // Move to first point
        d += `M ${x} ${y}`;
      } else {
        // Cubic bezier curve from previous point
        const prevOut = outTangents[i - 1] || [0, 0];
        const currIn = inTangents[i] || [0, 0];
        const [prevX, prevY] = vertices[i - 1];

        // Calculate control points
        const cp1x = prevX + prevOut[0];
        const cp1y = prevY + prevOut[1];
        const cp2x = x + currIn[0];
        const cp2y = y + currIn[1];

        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x} ${y}`;
      }
    }

    // Close path if needed
    if (closed && vertices.length > 0) {
      const lastOut = outTangents[vertices.length - 1] || [0, 0];
      const firstIn = inTangents[0] || [0, 0];
      const [lastX, lastY] = vertices[vertices.length - 1];
      const [firstX, firstY] = vertices[0];

      const cp1x = lastX + lastOut[0];
      const cp1y = lastY + lastOut[1];
      const cp2x = firstX + firstIn[0];
      const cp2y = firstY + firstIn[1];

      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${firstX} ${firstY} Z`;
    }

    return d;
  }

  /**
   * Convert Lottie normalized RGB to hex
   */
  private static rgbArrayToHex(r: number, g: number, b: number): string {
    const toHex = (n: number) => {
      const val = Math.round(n * 255);
      const clamped = Math.max(0, Math.min(255, val));
      return clamped.toString(16).padStart(2, '0');
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Extract keyframes from shape properties (fill, stroke)
   */
  private static extractShapeKeyframes(
    shapes: any[],
    layerId: string,
    fps: number
  ): Keyframe[] {
    const keyframes: Keyframe[] = [];

    const extractFromItems = (items: any[]) => {
      for (const item of items) {
        if (item.ty === 'gr' && item.it) {
          // Group - recurse
          extractFromItems(item.it);
        } else if (item.ty === 'fl') {
          // Fill
          if (item.c && item.c.a === 1) {
            keyframes.push(...this.extractColorKeyframes(item.c, 'fill', layerId, fps));
          }
        } else if (item.ty === 'st') {
          // Stroke
          if (item.c && item.c.a === 1) {
            keyframes.push(...this.extractColorKeyframes(item.c, 'stroke', layerId, fps));
          }
          if (item.w && item.w.a === 1) {
            keyframes.push(...this.extractNumericKeyframes(item.w, 'strokeWidth', layerId, fps));
          }
        }
      }
    };

    extractFromItems(shapes);
    return keyframes;
  }

  /**
   * Extract color keyframes
   */
  private static extractColorKeyframes(
    prop: LottieAnimatedProperty,
    propertyName: 'fill' | 'stroke',
    layerId: string,
    fps: number
  ): Keyframe[] {
    const keyframes: Keyframe[] = [];
    const lottieKeyframes = prop.k as LottieKeyframe[];

    for (const kf of lottieKeyframes) {
      const time = kf.t / fps;
      const [r, g, b] = kf.s as [number, number, number];
      const color = this.rgbArrayToHex(r, g, b);

      const easing = this.detectEasing(kf);
      const easingBezier = easing === 'custom' ? this.extractBezierTangents(kf) : undefined;

      keyframes.push({
        id: generateId(),
        time,
        property: propertyName,
        value: color,
        easing,
        easingBezier,
        layerId,
      } as any);
    }

    return keyframes;
  }

  /**
   * Extract keyframes from Lottie transform
   */
  private static extractKeyframes(
    ks: any,
    layerId: string,
    fps: number
  ): Keyframe[] {
    const keyframes: Keyframe[] = [];

    // Extract position keyframes
    if (ks.p && ks.p.a === 1) {
      keyframes.push(...this.extractPositionKeyframes(ks.p, layerId, fps));
    }

    // Extract scale keyframes
    if (ks.s && ks.s.a === 1) {
      keyframes.push(...this.extractScaleKeyframes(ks.s, layerId, fps));
    }

    // Extract rotation keyframes
    if (ks.r && ks.r.a === 1) {
      keyframes.push(...this.extractNumericKeyframes(ks.r, 'rotation', layerId, fps));
    }

    // Extract opacity keyframes
    if (ks.o && ks.o.a === 1) {
      keyframes.push(...this.extractOpacityKeyframes(ks.o, layerId, fps));
    }

    return keyframes;
  }

  /**
   * Extract position keyframes (split x/y)
   */
  private static extractPositionKeyframes(
    prop: LottieAnimatedProperty,
    layerId: string,
    fps: number
  ): Keyframe[] {
    const keyframes: Keyframe[] = [];
    const lottieKeyframes = prop.k as LottieKeyframe[];

    for (let i = 0; i < lottieKeyframes.length; i++) {
      const kf = lottieKeyframes[i];
      const time = kf.t / fps;
      const [x, y] = kf.s as [number, number];

      // Detect easing type
      const easing = this.detectEasing(kf);
      const easingBezier = easing === 'custom' ? this.extractBezierTangents(kf) : undefined;

      // Create x keyframe
      keyframes.push({
        id: generateId(),
        time,
        property: 'x',
        value: x,
        easing,
        easingBezier,
        layerId,
      } as any);

      // Create y keyframe
      keyframes.push({
        id: generateId(),
        time,
        property: 'y',
        value: y,
        easing,
        easingBezier,
        layerId,
      } as any);
    }

    return keyframes;
  }

  /**
   * Extract scale keyframes (convert percentage to multiplier)
   */
  private static extractScaleKeyframes(
    prop: LottieAnimatedProperty,
    layerId: string,
    fps: number
  ): Keyframe[] {
    const keyframes: Keyframe[] = [];
    const lottieKeyframes = prop.k as LottieKeyframe[];

    for (const kf of lottieKeyframes) {
      const time = kf.t / fps;
      const [scaleX, scaleY] = kf.s as [number, number];

      const easing = this.detectEasing(kf);
      const easingBezier = easing === 'custom' ? this.extractBezierTangents(kf) : undefined;

      keyframes.push({
        id: generateId(),
        time,
        property: 'scaleX',
        value: scaleX / 100,
        easing,
        easingBezier,
        layerId,
      } as any);

      keyframes.push({
        id: generateId(),
        time,
        property: 'scaleY',
        value: scaleY / 100,
        easing,
        easingBezier,
        layerId,
      } as any);
    }

    return keyframes;
  }

  /**
   * Extract opacity keyframes (convert 0-100 to 0-1)
   */
  private static extractOpacityKeyframes(
    prop: LottieAnimatedProperty,
    layerId: string,
    fps: number
  ): Keyframe[] {
    return this.extractNumericKeyframes(prop, 'opacity', layerId, fps, (v) => v / 100);
  }

  /**
   * Extract numeric property keyframes (rotation, strokeWidth, etc.)
   */
  private static extractNumericKeyframes(
    prop: LottieAnimatedProperty,
    propertyName: any,
    layerId: string,
    fps: number,
    transform?: (value: number) => number
  ): Keyframe[] {
    const keyframes: Keyframe[] = [];
    const lottieKeyframes = prop.k as LottieKeyframe[];

    for (const kf of lottieKeyframes) {
      const time = kf.t / fps;
      let value = Array.isArray(kf.s) ? kf.s[0] : kf.s;
      if (transform) value = transform(value);

      const easing = this.detectEasing(kf);
      const easingBezier = easing === 'custom' ? this.extractBezierTangents(kf) : undefined;

      keyframes.push({
        id: generateId(),
        time,
        property: propertyName,
        value,
        easing,
        easingBezier,
        layerId,
      } as any);
    }

    return keyframes;
  }

  /**
   * Detect easing type from Lottie keyframe
   */
  private static detectEasing(kf: LottieKeyframe): string {
    // Hold keyframe
    if (kf.h === 1) return 'hold';

    // No tangents = linear
    if (!kf.i || !kf.o) return 'linear';

    // Check if it matches preset tangents
    const ox = kf.o.x[0] ?? 0;
    const oy = kf.o.y[0] ?? 0;
    const ix = kf.i.x[0] ?? 1;
    const iy = kf.i.y[0] ?? 1;

    // Linear: straight line
    if (Math.abs(ox) < 0.01 && Math.abs(oy) < 0.01 && Math.abs(ix - 1) < 0.01 && Math.abs(iy - 1) < 0.01) {
      return 'linear';
    }

    // Ease-in: approximately (0.42, 0) (1, 1)
    if (Math.abs(ox - 0.42) < 0.05 && Math.abs(oy) < 0.05 && Math.abs(ix - 1) < 0.05 && Math.abs(iy - 1) < 0.05) {
      return 'easeIn';
    }

    // Ease-out: approximately (0, 0) (0.58, 1)
    if (Math.abs(ox) < 0.05 && Math.abs(oy) < 0.05 && Math.abs(ix - 0.58) < 0.05 && Math.abs(iy - 1) < 0.05) {
      return 'easeOut';
    }

    // Ease-in-out: approximately (0.333, 0) (0.667, 1)
    if (Math.abs(ox - 0.333) < 0.05 && Math.abs(oy) < 0.05 && Math.abs(ix - 0.667) < 0.05 && Math.abs(iy - 1) < 0.05) {
      return 'easeInOut';
    }

    // Custom bezier
    return 'custom';
  }

  /**
   * Extract bezier tangents from Lottie keyframe
   */
  private static extractBezierTangents(kf: LottieKeyframe): BezierTangents | undefined {
    if (!kf.i || !kf.o) return undefined;

    return {
      o: {
        x: [kf.o.x[0] ?? 0],
        y: [kf.o.y[0] ?? 0],
      },
      i: {
        x: [kf.i.x[0] ?? 1],
        y: [kf.i.y[0] ?? 1],
      },
    };
  }
}
