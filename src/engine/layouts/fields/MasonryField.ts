import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FieldDefinition, FieldContext } from '../FieldLayoutEngine';
import type { TileDescriptor, TileFootprint } from '../../tiles/TileTypes';

interface ColumnAnchor {
  column: number;
  x: number;
  z: number;
}

export class MasonryField implements FieldDefinition {
  public readonly id = 'masonry';
  public readonly name = 'Masonry Grid';

  private columnHeights: number[] = [];
  private columnCount = 1;
  private columnBaseWidth = 1;
  private columnGap = 0.4;
  private rowSpacing = 0.4;
  private groupAnchors = new Map<string, ColumnAnchor>();

  public sample(index: number, _time: number, context: FieldContext, target: Vector3): Vector3 {
    if (index === 0) {
      this.initializeColumns(context);
    }

    const descriptors = context.tileDescriptors ?? [];
    const descriptor: TileDescriptor | null = descriptors[index] ?? null;
    const footprints = context.tileFootprints ?? [];
    const footprint: TileFootprint | undefined = footprints[index];

    const column = this.pickColumn();
    const columnOffset = column - (this.columnCount - 1) / 2;
    const columnStep = this.columnBaseWidth + this.columnGap;
    const x = columnOffset * columnStep;
    const height = Math.max(footprint?.height ?? context.cubeSize, 0.01);
    const z = this.columnHeights[column] + height / 2;

    if (descriptor?.stacking?.role === 'leader') {
      this.groupAnchors.set(descriptor.stacking.groupId, { column, x, z });
    } else if (descriptor?.stacking?.inheritAnchorPosition) {
      const anchor = this.groupAnchors.get(descriptor.stacking.groupId);
      if (anchor) {
        return target.set(anchor.x, 0, anchor.z);
      }
    }

    const affectsFlow = descriptor?.stacking ? descriptor.stacking.affectsMasonryFlow : true;
    if (affectsFlow) {
      this.columnHeights[column] += height + this.rowSpacing;
    }

    return target.set(x, 0, z);
  }

  private initializeColumns(context: FieldContext): void {
    this.columnCount = Math.max(
      1,
      Math.round(context.masonryColumnCount ?? Math.sqrt(Math.max(1, context.totalCount))),
    );
    this.columnGap = Math.max(0, context.masonryColumnSpacing ?? context.cubeSpacing);
    this.rowSpacing = Math.max(0, context.masonryRowSpacing ?? context.cubeSpacing);

    const footprints = context.tileFootprints ?? [];
    let maxWidth = context.cubeSize;
    for (const footprint of footprints) {
      if (!footprint) continue;
      if (Number.isFinite(footprint.width)) {
        maxWidth = Math.max(maxWidth, footprint.width);
      }
    }
    this.columnBaseWidth = Math.max(maxWidth, context.cubeSize);

    this.columnHeights = Array.from({ length: this.columnCount }, () => 0);
    this.groupAnchors.clear();
  }

  private pickColumn(): number {
    let bestIndex = 0;
    let bestHeight = Number.POSITIVE_INFINITY;
    for (let column = 0; column < this.columnHeights.length; column += 1) {
      const height = this.columnHeights[column];
      if (height < bestHeight) {
        bestHeight = height;
        bestIndex = column;
      }
    }
    return bestIndex;
  }
}

