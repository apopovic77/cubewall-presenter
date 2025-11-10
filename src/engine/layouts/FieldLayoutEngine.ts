import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export interface FieldContext {
  totalCount: number;
  gridSize: number;
  cubeSize: number;
  cubeSpacing: number;
  waveAmplitudeY: number;
  waveFrequencyY: number;
  wavePhaseSpread: number;
}

export interface FieldDefinition {
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
};

export class FieldLayoutEngine {
  private field: FieldDefinition;
  private context: FieldContext;
  private samples: Vector3[] = [];

  constructor(field: FieldDefinition) {
    this.field = field;
    this.context = { ...DEFAULT_CONTEXT };
  }

  public setField(field: FieldDefinition): void {
    this.field = field;
  }

  public setContext(patch: Partial<FieldContext>): void {
    this.context = { ...this.context, ...patch };
  }

  public sample(index: number, time: number, target?: Vector3): Vector3 {
    const output = target ?? new Vector3(0, 0, 0);
    return this.field.sample(index, time, this.context, output);
  }

  public sampleAll(total: number, time: number): Vector3[] {
    if (this.samples.length !== total) {
      this.samples = Array.from({ length: total }, () => new Vector3(0, 0, 0));
    }
    this.context.totalCount = total;
    for (let index = 0; index < total; index += 1) {
      this.field.sample(index, time, this.context, this.samples[index]);
    }
    return this.samples;
  }
}

