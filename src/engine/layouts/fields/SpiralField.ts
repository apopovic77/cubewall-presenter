import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldContext, FieldDefinition } from '../FieldLayoutEngine';

export class SpiralField implements FieldDefinition {
  public readonly id = 'spiral';
  public readonly name = 'Spiral Flow';

  public sample(index: number, time: number, context: FieldContext, target: Vector3): Vector3 {
    const total = Math.max(1, context.totalCount);
    const t = index / total;
    const turns = (4 + Math.sin(time * 0.2) * 1.5) * 3;
    const angle = turns * Math.PI * 2 * t + time * 0.00001;
    const radiusBase = (context.gridSize * (context.cubeSize + context.cubeSpacing)) * 0.9;
    const radius = radiusBase * (0.2 + 0.8 * t);
    const yRange = radiusBase * 10;

    const y = (t - 0.5) * 2 * yRange + Math.sin(time * 0.7 + t * Math.PI * 6) * context.cubeSize * 0.4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const scale = context.globalScale ?? 1;
    return target.set(x * scale, y * scale, z * scale);
  }
}

