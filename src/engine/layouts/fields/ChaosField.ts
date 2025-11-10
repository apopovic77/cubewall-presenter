import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldContext, FieldDefinition } from '../FieldLayoutEngine';

export class ChaosField implements FieldDefinition {
  public readonly id = 'chaos';
  public readonly name = 'Chaos Flow';

  public sample(index: number, time: number, context: FieldContext, target: Vector3): Vector3 {
    const total = Math.max(1, context.totalCount);
    const u = index / total;
    const radiusBase = (context.gridSize * (context.cubeSize + context.cubeSpacing)) * 0.35;
    const t = time * 0.6;

    const x = Math.sin(u * 12 + t) * radiusBase * 0.6 + Math.cos(u * 18 - t * 1.2) * radiusBase * 0.4;
    const y = Math.cos(u * 9 + t * 0.8) * radiusBase * 0.4 + Math.sin(u * 17 - t * 1.1) * radiusBase * 0.3;
    const z = Math.sin(u * 14 - t * 0.9) * radiusBase * 0.55 + Math.cos(u * 11 + t * 1.3) * radiusBase * 0.35;

    const scale = context.globalScale ?? 1;
    return target.set(x * scale, y * scale, z * scale);
  }
}

