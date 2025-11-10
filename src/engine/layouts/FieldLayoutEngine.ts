import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export interface FieldContext {
  totalCount: number;
  gridSize: number;
  cubeSize: number;
  cubeSpacing: number;
  waveAmplitudeY: number;
  waveFrequencyY: number;
  wavePhaseSpread: number;
  globalScale: number;
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

export class FieldLayoutEngine {
  private readonly fields: FieldDefinition[];
  private context: FieldContext;
  private samples: Vector3[] = [];
  private currentIndex = 0;
  private nextIndex = 0;
  private morphProgress = 0;
  private morphDuration = DEFAULT_DURATION;
  private morphElapsed = 0;
  private morphing = false;
  private readonly currentScratch = new Vector3();
  private readonly nextScratch = new Vector3();

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

  public getNextField(): FieldDefinition {
    return this.fields[this.nextIndex];
  }

  public getFieldCount(): number {
    return this.fields.length;
  }

  public setContext(patch: Partial<FieldContext>): void {
    this.context = { ...this.context, ...patch };
  }

  public startMorphTo(targetIndex: number, durationSeconds: number = DEFAULT_DURATION): void {
    if (targetIndex < 0 || targetIndex >= this.fields.length) {
      throw new Error(`FieldLayoutEngine: targetIndex ${targetIndex} out of bounds`);
    }
    if (targetIndex === this.currentIndex) {
      this.morphing = false;
      this.morphProgress = 0;
      this.nextIndex = targetIndex;
      return;
    }
    this.nextIndex = targetIndex;
    this.morphElapsed = 0;
    this.morphDuration = Math.max(0.1, durationSeconds);
    this.morphProgress = 0;
    this.morphing = true;
  }

  public update(deltaSeconds: number): void {
    if (!this.morphing) {
      return;
    }
    this.morphElapsed += deltaSeconds;
    this.morphProgress = Math.min(1, this.morphElapsed / this.morphDuration);
    if (this.morphProgress >= 1) {
      this.currentIndex = this.nextIndex;
      this.morphing = false;
      this.morphProgress = 0;
    }
  }

  public isMorphing(): boolean {
    return this.morphing;
  }

  public getMorphProgress(): number {
    return this.morphProgress;
  }

  public getCurrentFieldIndex(): number {
    return this.currentIndex;
  }

  public sampleAll(total: number, time: number): Vector3[] {
    if (this.samples.length !== total) {
      this.samples = Array.from({ length: total }, () => new Vector3(0, 0, 0));
    }
    this.context.totalCount = total;
    const currentField = this.getCurrentField();
    const nextField = this.getNextField();

    for (let index = 0; index < total; index += 1) {
      currentField.sample(index, time, this.context, this.currentScratch);
      if (this.morphing) {
        nextField.sample(index, time, this.context, this.nextScratch);
        Vector3.LerpToRef(this.currentScratch, this.nextScratch, this.morphProgress, this.samples[index]);
      } else {
        this.samples[index].copyFrom(this.currentScratch);
      }
    }
    return this.samples;
  }
}

