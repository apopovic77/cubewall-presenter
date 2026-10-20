/**
 * Load test via URL: `?cubes=10000` builds a square grid with at least that
 * many cubes (capped at 150 × 150) and pulls the camera back to fit it. Such a
 * session never writes the shared settings store, so kiosks keep their grid.
 */
const MAX_STRESS_GRID = 150;
const DEFAULT_GRID = 25;

function readStressGridSize(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('cubes');
  if (!raw) return null;
  const cubes = Number.parseInt(raw, 10);
  if (!Number.isFinite(cubes) || cubes <= 0) return null;
  return Math.min(MAX_STRESS_GRID, Math.max(3, Math.ceil(Math.sqrt(cubes))));
}

/** Grid size requested by `?cubes=`, or null for a normal session. */
export const STRESS_GRID_SIZE = readStressGridSize();

/** Camera distance scaled with the field's width (the default frames 25 × 25). */
export function stressCameraRadius(baseRadius: number, gridSize: number): number {
  return baseRadius * Math.max(1, gridSize / DEFAULT_GRID);
}
