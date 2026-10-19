import '@babylonjs/core/Culling/ray';
import { useEffect, useRef } from 'react';
import type { CubeSelectionInfo } from '../engine/CubeField';
import { CubeWallPresenter } from '../engine/CubeWallPresenter';
import type { PresenterSettings } from '../config/PresenterSettings';
import type { AxisLabelDisplayState, BillboardDisplayState } from '../engine/CubeWallPresenter';
import type { ArMenuAction } from '../engine/xr/menu/ArMenuModel';

export interface CanvasStageProps {
  onSelectionChange?: (selection: CubeSelectionInfo | null) => void;
  onPresenterReady?: (presenter: CubeWallPresenter | null) => void;
  settings: PresenterSettings;
  onDebug?: (line: string) => void;
  onBillboardStateChange?: (state: BillboardDisplayState | null) => void;
  onAxisLabelsChange?: (labels: AxisLabelDisplayState[]) => void;
  onCameraSettingsChange?: (update: Partial<PresenterSettings>) => void;
  onArMenuAction?: (action: ArMenuAction) => void;
}

export function CanvasStage({
  onSelectionChange,
  onPresenterReady,
  settings,
  onDebug,
  onBillboardStateChange,
  onAxisLabelsChange,
  onCameraSettingsChange,
  onArMenuAction,
}: CanvasStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const presenterRef = useRef<CubeWallPresenter | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    // Canvas pixel size is owned by the Babylon engine (hardware scaling = 1/dpr);
    // SceneController resizes it whenever the element changes size.
    const presenter = new CubeWallPresenter({
      canvas,
      onSelectionChange,
      onDebug,
      onBillboardStateChange,
      onAxisLabelsChange,
      onCameraSettingsChange,
      onArMenuAction,
    });
    presenter.applySettings(settings);
    presenterRef.current = presenter;
    onPresenterReady?.(presenter);
    presenter.start();

    return () => {
      presenter.dispose();
      presenterRef.current = null;
      onPresenterReady?.(null);
      onBillboardStateChange?.(null);
      onAxisLabelsChange?.([]);
    };
  }, [onSelectionChange, onPresenterReady, onDebug, onBillboardStateChange, onAxisLabelsChange, onCameraSettingsChange, onArMenuAction]);

  useEffect(() => {
    presenterRef.current?.applySettings(settings);
  }, [settings]);

  return (
    <canvas
      ref={canvasRef}
      className="cw-canvas"
    />
  );
}
