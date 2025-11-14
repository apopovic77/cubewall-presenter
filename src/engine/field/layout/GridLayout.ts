import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldParametersLike, LayoutInterface } from '../FieldTypes';

export class GridLayout implements LayoutInterface {
  public computePosition(index: number, _totalCount: number, params: FieldParametersLike): Vector3 {
    const gridSize = Math.max(1, params.gridSize);
    const step = params.cellSize + params.cellSpacing;
    const half = (gridSize - 1) * 0.5;

    const row = Math.floor(index / gridSize);
    const col = index % gridSize;

    const x = (col - half) * step;
    const z = (row - half) * step;

    return new Vector3(x, 0, z);
  }

  public computeOrientation(_index: number, _totalCount: number, _params: FieldParametersLike): Quaternion {
    return Quaternion.Identity();
  }
}

