import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TileDescriptor, TileFootprint } from '../tiles/TileTypes';
import { FieldTransition } from '../transition/FieldTransition';
import { ImmediateFront, type ActivationFront } from '../transition/ActivationFront';
import { assignSlots } from '../transition/SlotAssigner';

export interface FieldContext {
  totalCount: number;
  gridSize: number;
  cubeSize: number;
  cubeSpacing: number;
  waveAmplitudeY: number;
  waveFrequencyY: number;
  wavePhaseSpread: number;
  globalScale: number;
  tileFootprints?: TileFootprint[];
  tileDescriptors?: TileDescriptor[];
  masonryColumnCount?: number;
  masonryColumnSpacing?: number;
  masonryRowSpacing?: number;
}

export interface FieldDefinition {
  readonly id: string;
  readonly name: string;
  sample(index: number, time: number, context: FieldContext, target: Vector3): Vector3;
}

const DEFAULT_CONTEXT: FieldContext = {
  totalCount: 0,
  gridSize: 1,
  cubeSize: 1,
  cubeSpacing: 0.25,
  waveAmplitudeY: 0,
  waveFrequencyY: 1,
  wavePhaseSpread: 0.2,
  globalScale: 1,
};

const DEFAULT_DURATION = 6;

/** How a transition into another field runs. */
export interface TransitionOptions {
  /** Where the elements are now (field space); they travel from here. */
  from: Vector3[];
  front: ActivationFront;
  /** Let elements claim the nearest free slot (free-form shapes) instead of keeping their index. */
  assignSlots: boolean;
  /** Travel time of one element once the front has reached it. */
  travelSeconds: number;
}

/**
 * Shapes the field can take (one FieldDefinition each: element index → position)
 * and the transition between two of them.
 *
 * Elements map to slots of the current field through `slotOf` (identity unless
 * a transition let them claim slots). A transition moves every element from its
 * position at the start to its slot in the target field, released by an
 * activation front; an interrupted transition simply starts the next one from
 * wherever the elements are.
 */
export class FieldLayoutEngine {
  private readonly fields: FieldDefinition[];
  private context: FieldContext;
  private samples: Vector3[] = [];
  private currentIndex = 0;
  private slotOf: Int32Array<ArrayBufferLike> = new Int32Array(0);
  private transition: FieldTransition | null = null;
  private readonly targetScratch = new Vector3();

  constructor(fields: FieldDefinition[]) {
    if (fields.length === 0) {
      throw new Error('FieldLayoutEngine requires at least one FieldDefinition');
    }
    this.fields = fields;
    this.context = { ...DEFAULT_CONTEXT };
  }

  public getCurrentField(): FieldDefinition {
    return this.fields[this.currentIndex];
  }

  /** Target of the running transition, or the current field. */
  public getNextField(): FieldDefinition {
    return this.fields[this.transition?.targetIndex ?? this.currentIndex];
  }

  public getFieldCount(): number {
    return this.fields.length;
  }

  public getFieldId(index: number): string | null {
    return this.fields[index]?.id ?? null;
  }

  public findFieldIndex(id: string): number {
    return this.fields.findIndex((field) => field.id === id);
  }

  public setContext(patch: Partial<FieldContext>): void {
    this.context = { ...this.context, ...patch };
  }

  /** Where every slot of field `index` is at `time` (field space). */
  public sampleField(index: number, count: number, time: number): Vector3[] {
    const field = this.fields[index];
    const context = { ...this.context, totalCount: count };
    return Array.from({ length: count }, (_, slot) => field.sample(slot, time, context, new Vector3()));
  }

  /** Starts a transition into field `targetIndex`. */
  public startTransition(targetIndex: number, time: number, options: TransitionOptions): void {
    if (targetIndex < 0 || targetIndex >= this.fields.length) {
      throw new Error(`FieldLayoutEngine: targetIndex ${targetIndex} out of bounds`);
    }
    const count = options.from.length;
    const delays = options.front.delays(options.from);
    let slots: Int32Array;
    if (options.assignSlots) {
      const order = new Int32Array(count).map((_, index) => index).sort((a, b) => delays[a] - delays[b]);
      slots = assignSlots(options.from, this.sampleField(targetIndex, count, time), order);
    } else {
      slots = new Int32Array(count).map((_, index) => index);
    }
    this.transition = new FieldTransition(targetIndex, options.from, slots, delays, options.travelSeconds);
  }

  /** Cross-fade into `targetIndex` from the current samples, all elements at once, keeping their index. */
  public startMorphTo(targetIndex: number, durationSeconds: number = DEFAULT_DURATION): void {
    if (targetIndex === this.currentIndex && !this.transition) return;
    const from = this.samples.map((sample) => sample.clone());
    this.startTransition(targetIndex, 0, {
      from,
      front: new ImmediateFront(),
      assignSlots: false,
      travelSeconds: Math.max(0.1, durationSeconds),
    });
  }

  public update(deltaSeconds: number): void {
    if (!this.transition) return;
    this.transition.advance(deltaSeconds);
    if (this.transition.done) {
      this.currentIndex = this.transition.targetIndex;
      this.slotOf = this.transition.slots;
      this.transition = null;
    }
  }

  public isMorphing(): boolean {
    return this.transition !== null;
  }

  public getMorphProgress(): number {
    return this.transition?.progress ?? 0;
  }

  public getCurrentFieldIndex(): number {
    return this.currentIndex;
  }

  public resetMorph(): void {
    this.transition = null;
  }

  public sampleAll(total: number, time: number): Vector3[] {
    if (this.samples.length !== total) {
      this.samples = Array.from({ length: total }, () => new Vector3(0, 0, 0));
    }
    if (this.slotOf.length !== total) {
      // A rebuilt field starts in index order.
      this.slotOf = new Int32Array(total).map((_, index) => index);
    }
    this.context.totalCount = total;
    const transition = this.transition;
    const field = this.getCurrentField();
    const target = transition ? this.fields[transition.targetIndex] : null;

    for (let index = 0; index < total; index += 1) {
      if (transition && target) {
        target.sample(transition.slots[index] ?? index, time, this.context, this.targetScratch);
        transition.sampleToRef(index, this.targetScratch, this.samples[index]);
      } else {
        field.sample(this.slotOf[index] ?? index, time, this.context, this.samples[index]);
      }
    }
    return this.samples;
  }
}
