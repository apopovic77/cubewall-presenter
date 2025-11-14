import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldContext, FieldDefinition } from '../FieldLayoutEngine';

export class LineWaveField implements FieldDefinition {
  public readonly id = 'line';
  public readonly name = 'Wave Line';

  public sample(index: number, time: number, context: FieldContext, target: Vector3): Vector3 {
    const total = Math.max(1, context.totalCount);
    const spacing = context.cubeSize + context.cubeSpacing;
    const offset = -((total - 1) * spacing) / 2;

    const x = offset + index * spacing;
    const z = 0;

    let y = 0;
    if (context.waveAmplitudeY !== 0) {
      const wavePhase = index * context.wavePhaseSpread;
      y = context.waveAmplitudeY * (
        Math.sin(x * context.waveFrequencyY + time + wavePhase * 0.5)
        + Math.cos(time * 0.7 + wavePhase * 0.3)
      );
    }

    const globalScale = context.globalScale ?? 1;
    return target.set(x * globalScale, y * globalScale, z);
  }
}

