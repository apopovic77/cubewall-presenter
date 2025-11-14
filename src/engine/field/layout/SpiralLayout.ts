import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldParametersLike, LayoutInterface } from '../FieldTypes';

export class SpiralLayout implements LayoutInterface {
  public computePosition(index: number, totalCount: number, params: FieldParametersLike): Vector3 {
    const t = totalCount <= 1 ? 0 : index / (totalCount - 1);
    const turns = Math.max(0.1, params.turns);
    const angle = turns * Math.PI * 2 * t;

    const radius = params.radius * (0.2 + 0.8 * t);
    const height = params.height;

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = -height * 0.5 + height * t;

    return new Vector3(x, y, z);
  }

  public computeOrientation(index: number, totalCount: number, params: FieldParametersLike): Quaternion {
    const t = totalCount <= 1 ? 0 : index / (totalCount - 1);
    const angle = params.turns * Math.PI * 2 * t;
    const forward = new Vector3(Math.cos(angle), params.height / Math.max(1, params.radius * params.turns * 2 * Math.PI), Math.sin(angle));
    forward.normalize();

    return Quaternion.FromLookDirectionLH(forward, Vector3.Up());
  }
}

