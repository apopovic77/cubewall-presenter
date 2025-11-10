import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldContext, FieldDefinition } from '../FieldLayoutEngine';

export class HelixField implements FieldDefinition {
  public readonly id = 'helix';
  public readonly name = 'Twin Helix';

  public sample(index: number, time: number, context: FieldContext, target: Vector3): Vector3 {
    const total = Math.max(1, context.totalCount);
    const t = index / total;
    const strand = index % 2 === 0 ? 1 : -1;
    const heightRange = (context.gridSize * (context.cubeSize + context.cubeSpacing)) * 0.7;
    const turns = 5 + Math.sin(time * 0.3) * 2;
    const angle = (turns * Math.PI * 2 * t * strand) + time * 0.5 * strand;
    const radius = (context.gridSize * (context.cubeSize + context.cubeSpacing)) * 0.18;
    const radiusVariance = Math.sin(time * 0.6 + index * 0.12) * context.cubeSize * 0.2;

    const x = Math.cos(angle) * (radius + radiusVariance);
    const z = Math.sin(angle) * (radius + radiusVariance);
    const y = (t - 0.5) * heightRange + Math.sin(time * 0.9 + t * Math.PI * 10) * context.cubeSize * 0.4;

    const scale = context.globalScale ?? 1;
    return target.set(x * scale, y * scale, z * scale);
  }
}

