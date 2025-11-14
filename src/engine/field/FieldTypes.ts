import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';

export enum FieldTopology {
  Cartesian = 'cartesian',
}

export enum FieldLayoutType {
  Grid = 'grid',
  Spiral = 'spiral',
}

export interface FieldTransform {
  position: Vector3;
  rotation: Quaternion;
}

export interface LayoutInterface {
  computePosition(index: number, totalCount: number, params: FieldParametersLike): Vector3;
  computeOrientation(index: number, totalCount: number, params: FieldParametersLike): Quaternion;
}

export interface FieldParametersLike {
  gridSize: number;
  cellSize: number;
  cellSpacing: number;
  radius: number;
  turns: number;
  height: number;
  waveAmplitudeY: number;
  waveFrequencyY: number;
  wavePhaseSpread: number;
  globalScale?: number;
}

