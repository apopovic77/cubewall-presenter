import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FieldContext } from './FieldContext';
import { FieldLayoutType } from './FieldTypes';
import type { FieldTransform } from './FieldTypes';

const TMP_POSITION = new Vector3();

export class FieldAwareness {
  private readonly context: FieldContext;

  constructor(context: FieldContext) {
    this.context = context;
  }

  public update(index: number, deltaTime: number): FieldTransform {
    this.context.updateTime(deltaTime);

    const layout = this.context.getLayoutInstance();
    const params = this.context.parameters;
    const total = this.context.totalCount;

    const basePosition = layout.computePosition(index, total, params);
    const baseRotation = layout.computeOrientation(index, total, params);

    const scale = params.globalScale ?? 1;
    const isGridLayout = this.context.layoutType === FieldLayoutType.Grid;

    if (isGridLayout) {
      const gridSize = Math.max(1, params.gridSize);
      const spacing = params.cellSize + params.cellSpacing;
      const offset = -((gridSize - 1) * spacing) / 2;
      const column = index % gridSize;
      const row = Math.floor(index / gridSize);
      const x = offset + column * spacing;
      const z = offset + row * spacing;
      let waveY = 0;
      if (params.waveAmplitudeY !== 0) {
        const wavePhase = (column * params.wavePhaseSpread) + (row * params.wavePhaseSpread * 0.7);
        const time = params.time;
        waveY = params.waveAmplitudeY * (
          Math.sin(x * params.waveFrequencyY + time + wavePhase * 0.5)
          + Math.cos(z * params.waveFrequencyY + time * 0.7 + wavePhase * 0.3)
        );
      }
      TMP_POSITION.set(x * scale, (basePosition.y + waveY) * scale, z * scale);
    } else {
      TMP_POSITION.copyFrom(basePosition);
      if (scale !== 1) {
        TMP_POSITION.scaleInPlace(scale);
      }
    }

    const hoverPhase = params.hoverPhase + index * 0.15;
    const hoverOffset = Math.sin(params.time * params.hoverFrequency + hoverPhase) * params.hoverAmplitude;

    TMP_POSITION.y += hoverOffset;

    const rotatePhase = index * 0.12;
    const rotationOffsetY = params.rotateAmplitude * Math.sin(params.time * params.rotateFrequency + rotatePhase);
    const rotationOffset = Quaternion.FromEulerAngles(0, rotationOffsetY, 0);

    const finalRotation = baseRotation.multiply(rotationOffset);

    // Apply optional layout-level rotation for grid to keep Y upright
    if (this.context.layoutType === FieldLayoutType.Grid) {
      finalRotation.normalize();
    }

    return {
      position: TMP_POSITION.clone(),
      rotation: finalRotation,
    };
  }
}

