import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldParametersLike } from './FieldTypes';

export class FieldParameters implements FieldParametersLike {
  public gridSize = 25;
  public cellSize = 1;
  public cellSpacing = 0.15;

  public radius = 12;
  public turns = 4;
  public height = 12;

  public hoverAmplitude = 0.15;
  public hoverFrequency = 0.8;
  public hoverPhase = 0;

  public rotateAmplitude = 0.05;
  public rotateFrequency = 0.5;

  public waveSpeed = 1;
  public waveAmplitudeY = 0.15;
  public waveFrequencyY = 0.3;
  public wavePhaseSpread = 0.05;
  public globalScale = 1;

  public time = 0;

  public customForward: Vector3 | null = null;
  public customUp: Vector3 | null = null;

  constructor(initial?: Partial<FieldParameters>) {
    if (initial) {
      this.update(initial);
    }
  }

  public update(values: Partial<FieldParameters>): void {
    Object.entries(values).forEach(([key, value]) => {
      if (value === undefined) return;
      (this as any)[key] = value;
    });
  }

  public updateTime(deltaSeconds: number): void {
    this.time += deltaSeconds * this.waveSpeed;
  }
}

