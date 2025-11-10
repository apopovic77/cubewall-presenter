import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldContext, FieldDefinition } from '../FieldLayoutEngine';

export class GridWaveField implements FieldDefinition {
  public readonly name = 'grid-wave';

  public sample(index: number, time: number, context: FieldContext, target: Vector3): Vector3 {
    const { gridSize, cubeSize, cubeSpacing, waveAmplitudeY, waveFrequencyY, wavePhaseSpread } = context;
    if (gridSize <= 0) {
      return target.set(0, 0, 0);
    }

    const column = index % gridSize;
    const row = Math.floor(index / gridSize);
    const spacing = cubeSize + cubeSpacing;
    const offset = -((gridSize - 1) * spacing) / 2;

    const x = offset + column * spacing;
    const z = offset + row * spacing;
    let y = 0;

    if (waveAmplitudeY !== 0) {
      const wavePhase = (column * wavePhaseSpread) + (row * wavePhaseSpread * 0.7);
      y = waveAmplitudeY * (
        Math.sin(x * waveFrequencyY + time + wavePhase * 0.5)
        + Math.cos(z * waveFrequencyY + time * 0.7 + wavePhase * 0.3)
      );
    }

    return target.set(x, y, z);
  }
}

