import { Vector3 } from '@babylonjs/core/Maths/math.vector';

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * One running change of shape: every element travels from where it was when
 * the transition started to its slot in the target field, starting when the
 * activation front reaches it (`delays`) and taking `travelSeconds`.
 */
export class FieldTransition {
  public readonly targetIndex: number;
  /** Element → slot in the target field. */
  public readonly slots: Int32Array;
  private readonly from: Vector3[];
  private readonly delays: Float32Array;
  private readonly travelSeconds: number;
  private readonly totalSeconds: number;
  private elapsed = 0;

  constructor(targetIndex: number, from: Vector3[], slots: Int32Array, delays: Float32Array, travelSeconds: number) {
    this.targetIndex = targetIndex;
    this.from = from;
    this.slots = slots;
    this.delays = delays;
    this.travelSeconds = Math.max(0.01, travelSeconds);
    let maxDelay = 0;
    for (let index = 0; index < delays.length; index += 1) maxDelay = Math.max(maxDelay, delays[index]);
    this.totalSeconds = maxDelay + this.travelSeconds;
  }

  public advance(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
  }

  public get done(): boolean {
    return this.elapsed >= this.totalSeconds;
  }

  /** Overall progress 0..1. */
  public get progress(): number {
    return Math.min(1, this.elapsed / this.totalSeconds);
  }

  /** Position of element `index`, given its target slot position. */
  public sampleToRef(index: number, target: Vector3, out: Vector3): Vector3 {
    const start = this.from[index];
    if (!start) return out.copyFrom(target);
    const local = (this.elapsed - (this.delays[index] ?? 0)) / this.travelSeconds;
    const t = easeInOutCubic(Math.min(1, Math.max(0, local)));
    return Vector3.LerpToRef(start, target, t, out);
  }
}
