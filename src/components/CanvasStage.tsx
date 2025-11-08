import '@babylonjs/core/Culling/ray';
import { useEffect, useRef } from 'react';
import type { CubeSelectionInfo } from '../engine/CubeField';
import { CubeWallPresenter } from '../engine/CubeWallPresenter';
import type { PresenterSettings } from '../config/PresenterSettings';
import type { AxisLabelDisplayState, BillboardDisplayState } from '../engine/CubeWallPresenter';

export interface CanvasStageProps {
  onSelectionChange?: (selection: CubeSelectionInfo | null) => void;
  onPresenterReady?: (presenter: CubeWallPresenter | null) => void;
  settings: PresenterSettings;
  onDebug?: (line: string) => void;
  onBillboardStateChange?: (state: BillboardDisplayState | null) => void;
  onAxisLabelsChange?: (labels: AxisLabelDisplayState[]) => void;
}

export function CanvasStage({ onSelectionChange, onPresenterReady, settings, onDebug, onBillboardStateChange, onAxisLabelsChange }: CanvasStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const presenterRef = useRef<CubeWallPresenter | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    // Set canvas size to match its display size
    const resizeCanvas = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resizeCanvas();

    const presenter = new CubeWallPresenter({
      canvas,
      onSelectionChange,
      onDebug,
      onBillboardStateChange,
      onAxisLabelsChange,
    });
    presenter.applySettings(settings);
    presenterRef.current = presenter;
    onPresenterReady?.(presenter);
    presenter.start();

    // Handle window resize
    const handleResize = () => {
      resizeCanvas();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      presenter.dispose();
      presenterRef.current = null;
      onPresenterReady?.(null);
      onBillboardStateChange?.(null);
      onAxisLabelsChange?.([]);
    };
  }, [onSelectionChange, onPresenterReady, onDebug, onBillboardStateChange, onAxisLabelsChange]);

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
