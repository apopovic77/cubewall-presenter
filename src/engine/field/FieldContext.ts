import { FieldLayoutType, FieldTopology } from './FieldTypes';
import type { LayoutInterface } from './FieldTypes';
import { FieldParameters } from './FieldParameters';
import { GridLayout } from './layout/GridLayout';
import { SpiralLayout } from './layout/SpiralLayout';

export class FieldContext {
  public readonly topology: FieldTopology;
  public layoutType: FieldLayoutType;
  public readonly parameters: FieldParameters;
  public totalCount: number;

  private _layoutInstance: LayoutInterface | null = null;

  constructor(
    topology: FieldTopology,
    layoutType: FieldLayoutType,
    parameters: FieldParameters,
    totalCount: number,
  ) {
    this.topology = topology;
    this.layoutType = layoutType;
    this.parameters = parameters;
    this.totalCount = totalCount;
  }

  public updateTotalCount(count: number): void {
    this.totalCount = count;
  }

  public updateLayout(type: FieldLayoutType): void {
    if (this.layoutType !== type) {
      this.layoutType = type;
      this._layoutInstance = null;
    }
  }

  public updateTime(deltaSeconds: number): void {
    this.parameters.updateTime(deltaSeconds);
  }

  public getLayoutInstance(): LayoutInterface {
    if (!this._layoutInstance) {
      this._layoutInstance = this.createLayoutInstance();
    }
    return this._layoutInstance;
  }

  private createLayoutInstance(): LayoutInterface {
    switch (this.layoutType) {
      case FieldLayoutType.Spiral:
        return new SpiralLayout();
      case FieldLayoutType.Grid:
      default:
        return new GridLayout();
    }
  }
}

