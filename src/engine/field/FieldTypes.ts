import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';

export const FieldTopology = {
  Cartesian: 'cartesian',
} as const;
export type FieldTopology = typeof FieldTopology[keyof typeof FieldTopology];

export const FieldLayoutType = {
  Grid: 'grid',
  Spiral: 'spiral',
} as const;
export type FieldLayoutType = typeof FieldLayoutType[keyof typeof FieldLayoutType];

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

