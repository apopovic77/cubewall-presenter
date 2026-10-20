import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Scene } from '@babylonjs/core/scene';
import { CubeField } from '../CubeField';
import type { CubeWallConfig, AxisLabelAxis } from '../../config/AppConfig';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Axis3DLabelManager, type AxisLabelData } from '../Axis3DLabelManager';
import type { AxisLabelDisplayState } from '../CubeWallPresenter';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Labels along the field's rows / columns (e.g. publishing days): as screen
 * positions for the React overlay, or as 3D text in the scene. Recomputed when
 * the camera moves or the layout changes (`markDirty`).
 */
export class AxisLabelController {
  private readonly scene: Scene;
  private readonly config: CubeWallConfig;
  private readonly cubeField: CubeField;
  private readonly getCamera: () => ArcRotateCamera;
  private readonly onLabelsChange?: (labels: AxisLabelDisplayState[]) => void;
  private readonly debug: (line: string) => void;
  private readonly labels3D: Axis3DLabelManager;
  private dirty = true;
  private readonly lastCameraPos = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  private readonly lastCameraTarget = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  private axisLabelStartDateMs = Number.NaN;
  private readonly axisLabelDateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });

  constructor(options: {
    scene: Scene;
    config: CubeWallConfig;
    cubeField: CubeField;
    getCamera: () => ArcRotateCamera;
    onLabelsChange?: (labels: AxisLabelDisplayState[]) => void;
    debug: (line: string) => void;
  }) {
    this.scene = options.scene;
    this.config = options.config;
    this.cubeField = options.cubeField;
    this.getCamera = options.getCamera;
    this.onLabelsChange = options.onLabelsChange;
    this.debug = options.debug;
    this.labels3D = new Axis3DLabelManager(this.scene);
  }

  public markDirty(): void {
    this.dirty = true;
  }

  /** Per frame: re-emits overlay labels once the camera has moved. */
  public frame(): void {
    const camera = this.getCamera();
    if (
      !Number.isFinite(this.lastCameraPos.x) ||
      Vector3.DistanceSquared(this.lastCameraPos, camera.position) > 1e-4 ||
      Vector3.DistanceSquared(this.lastCameraTarget, camera.target) > 1e-4
    ) {
      this.lastCameraPos.copyFrom(camera.position);
      this.lastCameraTarget.copyFrom(camera.target);
      this.dirty = true;
    }
    if (this.dirty && this.config.axisLabels.enabled && this.config.axisLabels.mode === 'overlay') {
      this.emitState();
    }
  }

  /** Settings changed (mode, offsets, start date). */
  public applySettings(): void {
    this.updateStartDate();
    if (this.config.axisLabels.enabled) {
      this.refreshAnchors();
    } else {
      this.onLabelsChange?.([]);
      this.labels3D.update([], this.getCamera().position);
    }
    this.dirty = true;
  }

  public dispose(): void {
    this.onLabelsChange?.([]);
    this.labels3D.dispose();
  }

  public debugSummary(): void {
    const snapshot = this.cubeField.getAxisValuesSnapshot();
    const rows = snapshot.rows
      .map((info, index) => {
        const base = this.formatDateLabelFromInput(info.label) || `Zeile ${index + 1}.`;
        const plus = this.formatPlusSuffix(info.count);
        return `${base}${plus}`.trim();
      })
      .filter((value) => value.length > 0);
    const columns = snapshot.columns
      .map((info, index) => {
        const base = info.label ?? `Spalte ${index + 1}`;
        const plus = this.formatPlusSuffix(info.count);
        return `${base}${plus}`.trim();
      })
      .filter((value) => value.length > 0);
    this.debug(
      `[AxisSummary] rows (first 10): ${rows.slice(0, 10).join(' | ') || '—'}`,
    );
    this.debug(
      `[AxisSummary] columns (first 10): ${columns.slice(0, 10).join(' | ') || '—'}`,
    );
  }

  private formatDateLabelFromInput(input: string | number | null | undefined): string {
    if (input === null || input === undefined) {
      return '';
    }
    const date =
      typeof input === 'number'
        ? new Date(input)
        : new Date(input);
    if (!Number.isNaN(date.getTime())) {
      const formatted = this.axisLabelDateFormatter.format(date);
      return formatted.endsWith('.') ? formatted : `${formatted}.`;
    }
    if (typeof input === 'string' && input.length > 0) {
      return input.endsWith('.') ? input : `${input}.`;
    }
    return '';
  }

  private formatPlusSuffix(count: number): string {
    if (!Number.isFinite(count) || count <= 0) {
      return '';
    }
    const capped = Math.min(count, 12);
    const icons = Array.from({ length: capped }, () => '(+)').join('');
    const overflow = count > capped ? ` (+${count - capped})` : '';
    return `  ${icons}${overflow}`;
  }

  private getAxisLabelAxes(): AxisLabelAxis[] {
    const recommended = this.cubeField.getRecommendedAxisLabelAxes();
    const axes = this.config.axisLabels.axes;
    if (Array.isArray(axes) && axes.length > 0) {
      const normalized = axes
        .map((axis) => (axis === 'columns' ? 'columns' : 'rows'))
        .filter((axis, index, arr) => arr.indexOf(axis) === index) as AxisLabelAxis[];
      if (recommended.length === 0) {
        return normalized;
      }
      const filtered = normalized.filter((axis) => recommended.includes(axis));
      if (filtered.length > 0) {
        return filtered;
      }
    }
    if (recommended.length > 0) {
      return recommended;
    }
    return ['rows'];
  }

  private computeAxisLabelData(): AxisLabelData[] {
    if (!this.config.axisLabels.enabled) {
      return [];
    }

    const offsetVector = new Vector3(
      this.config.axisLabels.offset.x,
      this.config.axisLabels.offset.y,
      this.config.axisLabels.offset.z,
    );

    const template = this.config.axisLabels.template || '{{row1}}';
    const startDateMs = this.axisLabelStartDateMs;
    const hasValidDate = Number.isFinite(startDateMs);

    const labels: AxisLabelData[] = [];

    const axes = this.getAxisLabelAxes();

    axes.forEach((axis) => {
      const anchors = this.cubeField.getAxisAnchors(axis);
      anchors.forEach((anchor, index) => {
        const worldPosition = anchor.add(offsetVector);

        let labelText = template;
        labelText = labelText.split('{{axis}}').join(axis);
        const axisInfo = this.cubeField.getAxisValueInfo(axis, index);
        const axisValueLabel = axisInfo?.label ?? '';
        labelText = labelText.split('{{value}}').join(axisValueLabel);

        if (axis === 'rows') {
          const count = axisInfo?.count ?? 0;
          const formattedFromTimestamp = this.formatDateLabelFromInput(axisInfo?.timestamp);
          const formattedFromLabel = this.formatDateLabelFromInput(axisInfo?.label ?? null);
          const formattedFromValue = this.formatDateLabelFromInput(axisValueLabel);
          let baseLabel =
            formattedFromTimestamp ||
            formattedFromLabel ||
            formattedFromValue;
          if (!baseLabel && hasValidDate) {
            const fallbackDate = startDateMs + index * this.config.axisLabels.stepDays * DAY_MS;
            baseLabel = this.formatDateLabelFromInput(fallbackDate);
          }
          if (!baseLabel) {
            baseLabel = `Zeile ${index + 1}.`;
          }
          const plusSuffix = this.formatPlusSuffix(count);
          labelText = `${baseLabel}${plusSuffix}`.trim();
        } else {
          labelText = labelText.split('{{col}}').join(index.toString());
          labelText = labelText.split('{{col1}}').join((index + 1).toString());
          labelText = labelText.split('{{row}}').join('');
          labelText = labelText.split('{{row1}}').join('');
          labelText = labelText.split('{{date}}').join('');
          const plusSuffix = this.formatPlusSuffix(axisInfo?.count ?? 0);
          if (plusSuffix) {
            const trimmed = labelText.trim();
            labelText = trimmed ? `${trimmed}${plusSuffix}` : plusSuffix.trim();
          }
        }

        if (labelText.trim()) {
          labels.push({
            id: `axis-${axis}-${index}`,
            axis,
            text: labelText,
            worldPosition,
          });
        }
      });
    });

    return labels;
  }

  public refreshAnchors(): void {
    this.update3DLabels();
    this.dirty = true;
  }

  public updateStartDate(): void {
    const parsed = Date.parse(this.config.axisLabels.startDateIso);
    this.axisLabelStartDateMs = Number.isNaN(parsed) ? Number.NaN : parsed;
  }

  public emitState(): void {
    if (!this.onLabelsChange) return;

    if (!this.config.axisLabels.enabled || this.config.axisLabels.mode !== 'overlay') {
      this.onLabelsChange([]);
      this.dirty = false;
      return;
    }
    const data = this.computeAxisLabelData();
    if (!data.length) {
      this.onLabelsChange([]);
      this.dirty = false;
      return;
    }

    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!canvas) {
      this.onLabelsChange([]);
      this.dirty = false;
      return;
    }

    const camera = this.getCamera();
    const transform = camera.getTransformationMatrix();
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const rect = canvas.getBoundingClientRect();

    const labels: AxisLabelDisplayState[] = [];

    data.forEach((label) => {
      const projected = Vector3.Project(label.worldPosition, Matrix.Identity(), transform, viewport);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < 0 || projected.z > 1) {
        return;
      }
      const normalizedX = (projected.x - viewport.x) / viewport.width;
      const normalizedY = (projected.y - viewport.y) / viewport.height;
      if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
        return;
      }
      labels.push({
        id: label.id,
        label: label.text,
        axis: label.axis,
        screenX: rect.left + normalizedX * rect.width,
        screenY: rect.top + normalizedY * rect.height,
      });
    });

    this.onLabelsChange(labels);
    this.dirty = false;
  }

  public update3DLabels(): void {
    if (!this.config.axisLabels.enabled || this.config.axisLabels.mode !== '3d') {
      this.labels3D.update([], this.getCamera().position);
      return;
    }

    const data = this.computeAxisLabelData();
    this.labels3D.update(data, this.getCamera().position);
  }
}
