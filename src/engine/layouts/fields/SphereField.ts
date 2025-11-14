import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldContext, FieldDefinition } from '../FieldLayoutEngine';

export class SphereField implements FieldDefinition {
  public readonly id = 'sphere';
  public readonly name = 'Fibonacci Sphere';

  public sample(index: number, time: number, context: FieldContext, target: Vector3): Vector3 {
    const total = Math.max(1, context.totalCount);
    const offset = 2 / total;
    const increment = Math.PI * (3 - Math.sqrt(5));
    const y = ((index * offset) - 1) + (offset / 2);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = (index % total) * increment;

    const radius = (context.gridSize * (context.cubeSize + context.cubeSpacing)) * 0.45;
    const radiusScale = radius;

    const x = Math.cos(theta) * r * radiusScale;
    const z = Math.sin(theta) * r * radiusScale;
    const yPos = y * radiusScale;

    const globalScale = context.globalScale ?? 1;
    return target.set(x * globalScale, yPos * globalScale, z * globalScale);
  }
}

