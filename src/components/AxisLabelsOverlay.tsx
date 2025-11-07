import type { AxisLabelDisplayState } from '../engine/CubeWallPresenter';

interface AxisLabelsOverlayProps {
  labels: AxisLabelDisplayState[];
}

export function AxisLabelsOverlay({ labels }: AxisLabelsOverlayProps) {
  if (!labels.length) {
    return null;
  }

  return (
    <div className="cw-axis-labels">
      {labels.map((label) => (
        <div
          key={label.id}
          className="cw-axis-label"
          style={{ left: `${label.screenX}px`, top: `${label.screenY}px` }}
        >
          {label.label}
        </div>
      ))}
    </div>
  );
}

