import type { CubeLayoutConfig } from './AppConfig';

/**
 * Per-session overrides from the URL, for looking at a setup without touching
 * the kiosks: a session with any of them writes neither the shared settings
 * store nor the settings cookie.
 *
 * - `?cubes=10000` load test: a square grid with at least that many cubes
 *   (capped at 150 × 150), content repeated, camera pulled back to fit.
 * - `?layout=masonry|grid|axis` start layout (masonry switches to tiles).
 * - `?captions=1|0` glass caption tiles under the image tiles.
 * - `?wave=0|1` wave motion (position and rotation).
 * - `?physics=classic|anchor` physics mode once the first content is laid out.
 */
const MAX_STRESS_GRID = 150;
const DEFAULT_GRID = 25;

export type SessionPhysicsMode = 'classic' | 'anchor';

const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

function readStressGridSize(): number | null {
  const raw = params.get('cubes');
  if (!raw) return null;
  const cubes = Number.parseInt(raw, 10);
  if (!Number.isFinite(cubes) || cubes <= 0) return null;
  return Math.min(MAX_STRESS_GRID, Math.max(3, Math.ceil(Math.sqrt(cubes))));
}

function readFlag(name: string): boolean | null {
  const raw = params.get(name);
  if (raw === null) return null;
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function readLayout(): CubeLayoutConfig['mode'] | null {
  const raw = params.get('layout');
  if (raw === 'masonry' || raw === 'axis') return raw;
  if (raw === 'grid' || raw === 'matrix') return 'matrix';
  return null;
}

function readPhysics(): SessionPhysicsMode | null {
  const raw = params.get('physics');
  return raw === 'classic' || raw === 'anchor' ? raw : null;
}

/** Grid size requested by `?cubes=`, or null for a normal session. */
export const STRESS_GRID_SIZE = readStressGridSize();
export const SESSION_LAYOUT = readLayout();
export const SESSION_CAPTIONS = readFlag('captions');
export const SESSION_WAVE = readFlag('wave');
export const SESSION_PHYSICS = readPhysics();

/** True if the URL overrides anything; such a session never persists settings. */
export const HAS_SESSION_OVERRIDES =
  STRESS_GRID_SIZE !== null ||
  SESSION_LAYOUT !== null ||
  SESSION_CAPTIONS !== null ||
  SESSION_WAVE !== null ||
  SESSION_PHYSICS !== null;

/** Camera distance scaled with the field's width (the default frames 25 × 25). */
export function stressCameraRadius(baseRadius: number, gridSize: number): number {
  return baseRadius * Math.max(1, gridSize / DEFAULT_GRID);
}
