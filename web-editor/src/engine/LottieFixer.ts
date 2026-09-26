import type { LottieAnimation } from '../models/LottieTypes';
import { walkAllLayers, walkColorProps } from './LottieModifier';

/**
 * LottieFixer - "Attempt fix" engine. Detects patterns known to trip up
 * stricter Lottie players (and that differed between the working and broken
 * test files), previews what each fix would change, and only applies the
 * fixes the user approves.
 */

export interface LottieIssue {
  id: string;
  label: string;
  hint: string;
  count: number;
}

export interface FixApplication {
  json: LottieAnimation;
  applied: { id: string; count: number }[];
  /** Human-readable change lines per fix, for the "what will be fixed" preview */
  details: { id: string; label: string; changes: string[] }[];
}

const MAX_DETAIL_LINES = 8;

function capLines(lines: string[], total: number): string[] {
  const shown = lines.slice(0, MAX_DETAIL_LINES);
  if (total > shown.length) shown.push(`…and ${total - shown.length} more`);
  return shown;
}

const STANDARD_ROOT_KEYS = ['v', 'fr', 'ip', 'op', 'w', 'h', 'nm', 'ddd', 'assets', 'layers'];

/** Count root layers whose out-point runs past the composition end */
function countOpOverruns(json: LottieAnimation): number {
  return (json.layers || []).filter((l) => (l.op ?? 0) > json.op).length;
}

function countIpUnderruns(json: LottieAnimation): number {
  return (json.layers || []).filter((l) => (l.ip ?? 0) < json.ip).length;
}

function countNonStandardKeys(json: LottieAnimation): number {
  return Object.keys(json as any).filter((k) => !STANDARD_ROOT_KEYS.includes(k)).length;
}

/** Keyframes without a start value `s` — old bodymovin exports rely on `e` */
function countMissingKeyframeStarts(json: LottieAnimation): number {
  let count = 0;
  const checkProps = (holder: any) => {
    for (const key of ['p', 'a', 's', 'r', 'o', 'c', 'w']) {
      const prop = holder?.[key];
      if (prop && prop.a === 1 && Array.isArray(prop.k)) {
        prop.k.forEach((kf: any) => {
          if (kf.s === undefined) count++;
        });
      }
    }
  };
  for (const layer of walkAllLayers(json)) {
    checkProps(layer.ks);
    const shapes = (layer as any).shapes as any[] | undefined;
    if (shapes) {
      for (const item of shapes) {
        if (item.ty === 'gr' && Array.isArray(item.it)) {
          item.it.forEach(checkProps);
        }
      }
    }
  }
  return count;
}

function countInvalidNumbers(json: LottieAnimation): number {
  let count = 0;
  const walk = (obj: any) => {
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (obj && typeof obj === 'object') { Object.values(obj).forEach(walk); return; }
    if (typeof obj === 'number' && !Number.isFinite(obj)) count++;
  };
  walk(json);
  return count;
}

/** Layers referencing precomp/image assets that don't exist in the assets map */
function countDanglingAssetRefs(json: LottieAnimation): number {
  const ids = new Set((json.assets || []).map((a) => a.id));
  return (json.layers || []).filter(
    (l: any) => (l.ty === 0 || l.ty === 2) && l.refId && !ids.has(l.refId)
  ).length;
}

function countOutOfRangeColors(json: LottieAnimation): number {
  let count = 0;
  for (const c of walkColorProps(json)) {
    if (c.slice(0, 3).some((v) => v < 0 || v > 1)) count++;
  }
  return count;
}

/**
 * Normalize designer hex colors to the canonical forms Android's
 * Color.parseColor accepts: #RRGGBB or #AARRGGBB.
 * Handles #000 shorthand, missing '#', 0x prefix and RRGGBBAA (alpha last,
 * the CSS convention) which Android rejects. Returns null for junk.
 */
export function normalizeHexColor(raw: string): string | null {
  let s = raw.trim();
  if (s.startsWith('#')) s = s.slice(1);
  else if (s.toLowerCase().startsWith('0x')) s = s.slice(2);
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (s.length === 6) return '#' + s.toLowerCase();
  if (s.length === 8) {
    // CSS puts alpha last; Android expects #AARRGGBB
    return ('#' + s.slice(6, 8) + s.slice(0, 6)).toLowerCase();
  }
  return null;
}

/** Is this string a hex color some strict players would choke on? */
function needsHexNormalization(value: string): boolean {
  if (typeof value !== 'string') return false;
  const body = value.trim().replace(/^#/, '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(body)) return false;
  // Canonical for Lottie + Android: #RRGGBB (8-digit kept, it's parseable
  // once reordered — handled by the fix, so it counts here)
  return !/^#[0-9a-fA-F]{6}$/.test(value.trim());
}

const HEX_COLOR_KEYS = ['sc', 'cl']; // solid layer color, layer/shape color label

function collectHexColorIssues(
  json: LottieAnimation,
  mutate: boolean,
  examples?: string[]
): number {
  let count = 0;
  const walk = (obj: any) => {
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (HEX_COLOR_KEYS.includes(key) && needsHexNormalization(value)) {
          const normalized = normalizeHexColor(value);
          if (normalized !== null && normalized !== value) {
            count++;
            if (examples && examples.length < MAX_DETAIL_LINES + 1) {
              examples.push(`${key}: "${value}" → "${normalized}"`);
            }
            if (mutate) obj[key] = normalized;
          }
          continue;
        }
        walk(value);
      }
    }
  };
  walk(json);
  return count;
}

export function analyzeLottieIssues(source: LottieAnimation): LottieIssue[] {
  const issues: LottieIssue[] = [
    {
      id: 'op-overrun',
      label: 'Layers ending after the composition',
      hint: 'Native players can stall or blank on layers that outlive the comp. Clamp them to the comp end.',
      count: countOpOverruns(source),
    },
    {
      id: 'ip-underrun',
      label: 'Layers starting before the composition',
      hint: 'Layers with negative/pre-comp in-points confuse strict players. Clamp them to the comp start.',
      count: countIpUnderruns(source),
    },
    {
      id: 'nonstandard-keys',
      label: 'Non-standard top-level keys',
      hint: 'Keys like "props", "markers" or "meta" are exporter extras that some parsers reject.',
      count: countNonStandardKeys(source),
    },
    {
      id: 'missing-keyframe-s',
      label: 'Keyframes missing start values',
      hint: 'Old bodymovin exports omit "s" on keyframes and rely on "e". Players that only read "s" break.',
      count: countMissingKeyframeStarts(source),
    },
    {
      id: 'invalid-numbers',
      label: 'NaN / Infinity values',
      hint: 'A single invalid number can freeze a native renderer.',
      count: countInvalidNumbers(source),
    },
    {
      id: 'dangling-assets',
      label: 'Layers referencing missing assets',
      hint: 'Precomp/image layers pointing at assets that were never embedded render as nothing — or crash.',
      count: countDanglingAssetRefs(source),
    },
    {
      id: 'color-out-of-range',
      label: 'Vector colors outside 0–1 range',
      hint: 'Clamps channel values that escape the normalized color range.',
      count: countOutOfRangeColors(source),
    },
    {
      id: 'hex-colors',
      label: 'Shorthand / malformed hex colors',
      hint: 'Designers often ship "#000" or alpha-last hex. Android only parses #RRGGBB / #AARRGGBB — expands shorthand, adds missing #, fixes alpha order.',
      count: collectHexColorIssues(source, false),
    },
  ];
  return issues.filter((i) => i.count > 0);
}

export function fixLottie(
  source: LottieAnimation,
  selectedIds: string[]
): FixApplication {
  const applied: { id: string; count: number }[] = [];
  const details: { id: string; label: string; changes: string[] }[] = [];
  let json: LottieAnimation = structuredClone(source);
  const has = (id: string) => selectedIds.includes(id);
  const record = (id: string, label: string, count: number, lines: string[]) => {
    if (count > 0) {
      applied.push({ id, count });
      details.push({ id, label, changes: capLines(lines, count) });
    }
  };

  if (has('op-overrun')) {
    let count = 0;
    const lines: string[] = [];
    for (const layer of json.layers || []) {
      if (layer.op > json.op) {
        lines.push(`Layer "${layer.nm ?? layer.ind}": op ${layer.op} → ${json.op}`);
        layer.op = json.op;
        count++;
      }
    }
    record('op-overrun', 'Clamp layers ending after the composition', count, lines);
  }

  if (has('ip-underrun')) {
    let count = 0;
    const lines: string[] = [];
    for (const layer of json.layers || []) {
      if (layer.ip < json.ip) {
        lines.push(`Layer "${layer.nm ?? layer.ind}": ip ${layer.ip} → ${json.ip}`);
        layer.ip = json.ip;
        count++;
      }
    }
    record('ip-underrun', 'Clamp layers starting before the composition', count, lines);
  }

  if (has('nonstandard-keys')) {
    let count = 0;
    const lines: string[] = [];
    for (const key of Object.keys(json as any)) {
      if (!STANDARD_ROOT_KEYS.includes(key)) {
        lines.push(`Removed top-level key "${key}"`);
        delete (json as any)[key];
        count++;
      }
    }
    record('nonstandard-keys', 'Remove non-standard top-level keys', count, lines);
  }

  if (has('missing-keyframe-s')) {
    let count = 0;
    const lines: string[] = [];
    const fixProps = (holder: any, where: string) => {
      for (const key of ['p', 'a', 's', 'r', 'o', 'c', 'w']) {
        const prop = holder?.[key];
        if (prop && prop.a === 1 && Array.isArray(prop.k)) {
          for (let i = 0; i < prop.k.length; i++) {
            const kf = prop.k[i];
            if (kf.s === undefined) {
              const prev = prop.k[i - 1];
              if (prev?.e !== undefined) kf.s = prev.e;
              else if (prev?.s !== undefined) kf.s = prev.s;
              else if (prop.k[i + 1]?.s !== undefined) kf.s = prop.k[i + 1].s;
              if (lines.length < MAX_DETAIL_LINES + 1) {
                lines.push(`${where} · ${key} keyframe @t=${kf.t}: s filled from previous value`);
              }
              count++;
            }
          }
        }
      }
    };
    for (const layer of walkAllLayers(json)) {
      fixProps(layer.ks, `Layer "${layer.nm ?? layer.ind}"`);
      const shapes = (layer as any).shapes as any[] | undefined;
      if (shapes) {
        for (const item of shapes) {
          if (item.ty === 'gr' && Array.isArray(item.it)) {
            item.it.forEach((sub: any) => fixProps(sub, `Layer "${layer.nm ?? layer.ind}" shape`));
          }
        }
      }
    }
    record('missing-keyframe-s', 'Fill missing keyframe start values', count, lines);
  }

  if (has('invalid-numbers')) {
    let count = 0;
    const lines: string[] = [];
    const fix = (obj: any, path: string): any => {
      if (Array.isArray(obj)) return obj.map((v, i) => fix(v, `${path}[${i}]`));
      if (obj && typeof obj === 'object') {
        const out: any = {};
        for (const key of Object.keys(obj)) out[key] = fix(obj[key], `${path}.${key}`);
        return out;
      }
      if (typeof obj === 'number' && !Number.isFinite(obj)) {
        count++;
        if (lines.length < MAX_DETAIL_LINES + 1) lines.push(`${path}: ${obj} → 0`);
        return 0;
      }
      return obj;
    };
    json = fix(json, 'root');
    record('invalid-numbers', 'Replace NaN / Infinity with 0', count, lines);
  }

  if (has('dangling-assets')) {
    const ids = new Set((json.assets || []).map((a) => a.id));
    const lines: string[] = [];
    const before = (json.layers || []).length;
    json.layers = (json.layers || []).filter((l: any) => {
      const dangling = (l.ty === 0 || l.ty === 2) && l.refId && !ids.has(l.refId);
      if (dangling && lines.length < MAX_DETAIL_LINES + 1) {
        lines.push(`Removed layer "${l.nm ?? l.ind}" (references missing asset "${l.refId}")`);
      }
      return !dangling;
    });
    record('dangling-assets', 'Remove layers referencing missing assets', before - json.layers.length, lines);
  }

  if (has('color-out-of-range')) {
    let count = 0;
    const lines: string[] = [];
    for (const c of walkColorProps(json)) {
      if (c.slice(0, 3).some((v) => v < 0 || v > 1)) {
        if (lines.length < MAX_DETAIL_LINES + 1) {
          lines.push(`Color [${c.slice(0, 3).map((v) => v.toFixed(2)).join(', ')}] clamped to 0–1`);
        }
        for (let i = 0; i < 3; i++) c[i] = Math.max(0, Math.min(1, c[i]));
        count++;
      }
    }
    record('color-out-of-range', 'Clamp vector colors to 0–1', count, lines);
  }

  if (has('hex-colors')) {
    const lines: string[] = [];
    const count = collectHexColorIssues(json, true, lines);
    record('hex-colors', 'Normalize hex colors to #RRGGBB / #AARRGGBB', count, lines);
  }

  return { json, applied, details };
}
