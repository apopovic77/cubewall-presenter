import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export type ActivationFrontMode = 'sphere' | 'plane' | 'none';

/**
 * Decides when each element of a transition starts moving, like an activation
 * volume sweeping through a VFX simulation: an element starts once the front
 * reaches it. Positions are in field (root) space.
 */
export interface ActivationFront {
  readonly mode: ActivationFrontMode;
  /** Start delay in seconds for every position. */
  delays(positions: readonly Vector3[]): Float32Array;
}

/** Everything starts at once (the classic cross-fade). */
export class ImmediateFront implements ActivationFront {
  public readonly mode = 'none' as const;

  public delays(positions: readonly Vector3[]): Float32Array {
    return new Float32Array(positions.length);
  }
}

/** A sphere growing from `origin`; it reaches the farthest element after `sweepSeconds`. */
export class SphereFront implements ActivationFront {
  public readonly mode = 'sphere' as const;
  private readonly origin: Vector3;
  private readonly sweepSeconds: number;

  constructor(origin: Vector3, sweepSeconds: number) {
    this.origin = origin.clone();
    this.sweepSeconds = sweepSeconds;
  }

  public delays(positions: readonly Vector3[]): Float32Array {
    const out = new Float32Array(positions.length);
    let max = 0;
    positions.forEach((position, index) => {
      out[index] = Vector3.Distance(this.origin, position);
      max = Math.max(max, out[index]);
    });
    const scale = max > 1e-6 ? this.sweepSeconds / max : 0;
    for (let index = 0; index < out.length; index += 1) out[index] *= scale;
    return out;
  }
}

/** A plane moving along `direction`, entering at the element nearest to `origin`. */
export class PlaneFront implements ActivationFront {
  public readonly mode = 'plane' as const;
  private readonly origin: Vector3;
  private readonly direction: Vector3;
  private readonly sweepSeconds: number;

  constructor(origin: Vector3, direction: Vector3, sweepSeconds: number) {
    this.origin = origin.clone();
    this.direction = direction.lengthSquared() > 1e-9 ? direction.normalizeToNew() : new Vector3(0, 0, 1);
    this.sweepSeconds = sweepSeconds;
  }

  public delays(positions: readonly Vector3[]): Float32Array {
    const out = new Float32Array(positions.length);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    positions.forEach((position, index) => {
      out[index] = Vector3.Dot(position.subtract(this.origin), this.direction);
      min = Math.min(min, out[index]);
      max = Math.max(max, out[index]);
    });
    const range = max - min;
    const scale = range > 1e-6 ? this.sweepSeconds / range : 0;
    for (let index = 0; index < out.length; index += 1) out[index] = (out[index] - min) * scale;
    return out;
  }
}

/**
 * Front for a transition started by a viewer at `viewer` (field space): it
 * enters the field on the viewer's side and rolls away from them.
 */
export function createActivationFront(
  mode: ActivationFrontMode,
  viewer: Vector3 | null,
  positions: readonly Vector3[],
  sweepSeconds: number,
): ActivationFront {
  if (mode === 'none' || positions.length === 0) return new ImmediateFront();
  const centroid = positions.reduce((sum, position) => sum.addInPlace(position), Vector3.Zero()).scaleInPlace(1 / positions.length);
  const from = viewer ?? centroid;
  if (mode === 'plane') {
    const direction = centroid.subtract(from);
    direction.y = 0;
    return new PlaneFront(from, direction, sweepSeconds);
  }
  // The sphere starts at the element nearest to the viewer, not in mid-air.
  let nearest = positions[0];
  let best = Number.POSITIVE_INFINITY;
  positions.forEach((position) => {
    const distance = Vector3.DistanceSquared(position, from);
    if (distance < best) {
      best = distance;
      nearest = position;
    }
  });
  return new SphereFront(nearest, sweepSeconds);
}
