import type { ChangeEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PresenterSettings } from '../config/PresenterSettings';

export interface SettingsPanelProps {
  isOpen: boolean;
  settings: PresenterSettings;
  onChange: (update: Partial<PresenterSettings>) => void;
  onClose: () => void;
  position: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
}

interface SliderSpec {
  key: keyof PresenterSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  formatter?: (value: number) => string;
  isEnabled?: (settings: PresenterSettings) => boolean;
}

const SLIDERS: SliderSpec[] = [
  { key: 'gridSize', label: 'Grid Size', min: 5, max: 35, step: 1, formatter: (v) => `${Math.round(v)}` },
  { key: 'waveSpeed', label: 'Wave Speed', min: 0, max: 1, step: 0.02, formatter: (v) => v.toFixed(2) },
  { key: 'waveAmplitudeY', label: 'Wave Height', min: 0, max: 0.6, step: 0.02, formatter: (v) => v.toFixed(2) },
  { key: 'waveAmplitudeRot', label: 'Wave Tilt', min: 0, max: 0.4, step: 0.01, formatter: (v) => v.toFixed(2) },
  { key: 'autoSelectInterval', label: 'Auto Select Interval', min: 1, max: 30, step: 0.5, formatter: (v) => `${v.toFixed(1)}s`, isEnabled: (s) => s.autoSelectEnabled },
  { key: 'slowAutorotateSpeed', label: 'Slow Autorotate Speed', min: 0, max: 1, step: 0.01, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.slowAutorotateEnabled },
  { key: 'depthOfFieldFocusDistance', label: 'DoF Focus Distance', min: 10, max: 500, step: 5, formatter: (v) => `${Math.round(v)}`, isEnabled: (s) => s.depthOfFieldEnabled && !s.depthOfFieldAutoFocusEnabled },
  { key: 'depthOfFieldFStop', label: 'DoF f-stop', min: 0.1, max: 16, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.depthOfFieldEnabled },
  { key: 'depthOfFieldFocalLength', label: 'DoF Focal Length', min: 1, max: 300, step: 1, formatter: (v) => `${Math.round(v)}mm`, isEnabled: (s) => s.depthOfFieldEnabled },
  { key: 'depthOfFieldAutoFocusOffset', label: 'DoF Auto Focus Offset', min: -3, max: 3, step: 0.01, formatter: (v) => `${v.toFixed(2)}`, isEnabled: (s) => s.depthOfFieldEnabled && s.depthOfFieldAutoFocusEnabled },
  { key: 'depthOfFieldAutoFocusSharpness', label: 'DoF Sharpness Scale', min: 0.1, max: 3, step: 0.05, formatter: (v) => `${v.toFixed(2)}x`, isEnabled: (s) => s.depthOfFieldEnabled && s.depthOfFieldAutoFocusEnabled },
  { key: 'interactionRadius', label: 'Ripple Radius', min: 1, max: 8, step: 0.1, formatter: (v) => v.toFixed(1) },
  { key: 'interactionLift', label: 'Ripple Lift', min: 0, max: 2.5, step: 0.05, formatter: (v) => v.toFixed(2) },
  { key: 'selectedCubeRotation', label: 'Selected Spin', min: 0, max: Math.PI, step: 0.05, formatter: (v) => `${(v * 180 / Math.PI).toFixed(0)}°` },
  { key: 'selectedCubeLift', label: 'Selected Lift', min: 0, max: 10, step: 0.1, formatter: (v) => v.toFixed(1) },
  { key: 'cameraRadius', label: 'Camera Radius', min: 20, max: 160, step: 1, formatter: (v) => `${Math.round(v)}` },
  { key: 'flyToRadiusFactor', label: 'Fly-To Radius', min: 1, max: 25, step: 0.1, formatter: (v) => v.toFixed(1) },
  { key: 'cameraLerpSpeed', label: 'Camera Lerp Speed', min: 0.01, max: 0.2, step: 0.005, formatter: (v) => v.toFixed(3) },
  { key: 'cameraOffsetX', label: 'Camera Offset X', min: -10, max: 10, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.useCustomCamera },
  { key: 'cameraOffsetY', label: 'Camera Offset Y', min: -10, max: 10, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.useCustomCamera },
  { key: 'cameraOffsetZ', label: 'Camera Offset Z', min: -10, max: 10, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.useCustomCamera },
  { key: 'cameraLookAtOffsetX', label: 'LookAt Offset X', min: -5, max: 5, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.useCustomCamera },
  { key: 'cameraLookAtOffsetY', label: 'LookAt Offset Y', min: -5, max: 5, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.useCustomCamera },
  { key: 'cameraLookAtOffsetZ', label: 'LookAt Offset Z', min: -5, max: 5, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.useCustomCamera },
  { key: 'cameraAnimationSpeed', label: 'Camera Anim Speed', min: 0.1, max: 5, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.useCustomCamera },
  { key: 'ambientLightIntensity', label: 'Ambient Intensity', min: 0, max: 2, step: 0.01, formatter: (v) => v.toFixed(2) },
  { key: 'directionalLightIntensity', label: 'Direct Intensity', min: 0, max: 2, step: 0.01, formatter: (v) => v.toFixed(2) },
  { key: 'directionalLightDirectionX', label: 'Light Dir X', min: -1, max: 1, step: 0.02, formatter: (v) => v.toFixed(2) },
  { key: 'directionalLightDirectionY', label: 'Light Dir Y', min: -1, max: 1, step: 0.02, formatter: (v) => v.toFixed(2) },
  { key: 'directionalLightDirectionZ', label: 'Light Dir Z', min: -1, max: 1, step: 0.02, formatter: (v) => v.toFixed(2) },
  { key: 'fillLightIntensity', label: 'Fill Intensity', min: 0, max: 2, step: 0.01, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.fillLightEnabled },
  { key: 'fillLightDirectionX', label: 'Fill Dir X', min: -1, max: 1, step: 0.02, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.fillLightEnabled },
  { key: 'fillLightDirectionY', label: 'Fill Dir Y', min: -1, max: 1, step: 0.02, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.fillLightEnabled },
  { key: 'fillLightDirectionZ', label: 'Fill Dir Z', min: -1, max: 1, step: 0.02, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.fillLightEnabled },
  { key: 'billboardHeightOffset', label: 'Billboard Height', min: 0, max: 5, step: 0.05, formatter: (v) => v.toFixed(2) },
  { key: 'billboardDistance', label: 'Billboard Distance', min: 0, max: 5, step: 0.05, formatter: (v) => v.toFixed(2) },
  { key: 'billboardAngleDegrees', label: 'Billboard Angle°', min: -180, max: 180, step: 1, formatter: (v) => `${Math.round(v)}°` },
  { key: 'axisLabelsOffsetX', label: 'Axis Offset X', min: -5, max: 5, step: 0.05, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.axisLabelsEnabled },
  { key: 'axisLabelsOffsetY', label: 'Axis Offset Y', min: -5, max: 5, step: 0.05, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.axisLabelsEnabled },
  { key: 'axisLabelsOffsetZ', label: 'Axis Offset Z', min: -5, max: 5, step: 0.05, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.axisLabelsEnabled },
];

export function SettingsPanel({ isOpen, settings, onChange, onClose, position, onPositionChange }: SettingsPanelProps) {
  const handleInput = (spec: SliderSpec) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value);
    onChange({ [spec.key]: value } as Partial<PresenterSettings>);
  };

  const dragStart = { x: 0, y: 0, panelX: 0, panelY: 0 };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStart.x = event.clientX;
    dragStart.y = event.clientY;
    dragStart.panelX = position.x;
    dragStart.panelY = position.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStart.x;
      const deltaY = moveEvent.clientY - dragStart.y;
      onPositionChange({ x: dragStart.panelX + deltaX, y: dragStart.panelY + deltaY });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <AnimatePresence>
      {isOpen && (
          <motion.aside
            key="settings-panel"
            className="cw-settings"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', damping: 18, stiffness: 160 }}
            style={{ left: position.x, top: position.y }}
          >
            <header className="cw-settings__header" onMouseDown={handleMouseDown}>
              <div>
                <h2>Cube Wall Controls</h2>
                <p>Glassmorphism control panel. Press F1 to toggle, Esc to close.</p>
              </div>
              <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={onClose}>Close</button>
            </header>
            <div className="cw-settings__toggles">
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.enableHoverInteraction}
                  onChange={(event) => onChange({ enableHoverInteraction: event.target.checked })}
                />
                <span>Enable Hover Ripple Effect</span>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.autoSelectEnabled}
                  onChange={(event) => onChange({ autoSelectEnabled: event.target.checked })}
                />
                <span>Enable Auto Selection Mode</span>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.showSelectionOverlay}
                  onChange={(event) => onChange({ showSelectionOverlay: event.target.checked })}
                />
                <span>Show Selection Overlay</span>
              </label>
              <label className="cw-settings__toggle">
                <span>Pop-Out Direction</span>
                <select
                  value={settings.selectedCubeNormalDirection}
                  onChange={(event) => onChange({
                    selectedCubeNormalDirection: Number(event.target.value) as PresenterSettings['selectedCubeNormalDirection'],
                  })}
                >
                  <option value={1}>Along plane normal</option>
                  <option value={-1}>Opposite normal (mirror)</option>
                </select>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.showDebugOverlay}
                  onChange={(event) => onChange({ showDebugOverlay: event.target.checked })}
                />
                <span>Show Debug Overlay</span>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.slowAutorotateEnabled}
                  onChange={(event) => onChange({ slowAutorotateEnabled: event.target.checked })}
                />
                <span>Enable Slow Autorotate</span>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.selectionCameraFollowEnabled}
                  onChange={(event) => onChange({ selectionCameraFollowEnabled: event.target.checked })}
                />
                <span>Camera follows selected cube</span>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.depthOfFieldEnabled}
                  onChange={(event) => onChange({ depthOfFieldEnabled: event.target.checked })}
                />
                <span>Enable Depth of Field</span>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.depthOfFieldAutoFocusEnabled}
                  onChange={(event) => onChange({ depthOfFieldAutoFocusEnabled: event.target.checked })}
                  disabled={!settings.depthOfFieldEnabled}
                />
                <span>Depth of Field auto-focus on selected cube</span>
              </label>
              <label className="cw-settings__toggle">
                <span>DoF Blur Level</span>
                <select
                  value={settings.depthOfFieldBlurLevel}
                  onChange={(event) => onChange({ depthOfFieldBlurLevel: event.target.value as PresenterSettings['depthOfFieldBlurLevel'] })}
                  disabled={!settings.depthOfFieldEnabled}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.useCustomCamera}
                  onChange={(event) => onChange({ useCustomCamera: event.target.checked })}
                />
                <span>Use Custom Selected Camera</span>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.useFallbackImages}
                  onChange={(event) => onChange({ useFallbackImages: event.target.checked })}
                />
                <span>Use Static Fallback Textures</span>
              </label>
              <label className="cw-settings__toggle">
                <span>Texture UV Layout</span>
                <select
                  value={settings.textureUvLayout}
                  onChange={(event) => onChange({ textureUvLayout: event.target.value as PresenterSettings['textureUvLayout'] })}
                >
                  <option value="standard">Standard (all faces aligned)</option>
                  <option value="mirrorTopAndAlternatingSides">Mirror bottom, alternate side faces</option>
                </select>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.fillLightEnabled}
                  onChange={(event) => onChange({ fillLightEnabled: event.target.checked })}
                />
                <span>Enable Fill Light</span>
              </label>
              <label className="cw-settings__toggle">
                <span>Billboard Mode</span>
                <select
                  value={settings.billboardMode}
                  onChange={(event) => onChange({ billboardMode: event.target.value as PresenterSettings['billboardMode'] })}
                >
                  <option value="3d">3D Panel</option>
                  <option value="html">HTML Overlay</option>
                </select>
              </label>
              <label className="cw-settings__toggle">
                <span>Background Mode</span>
                <select
                  value={settings.backgroundType}
                  onChange={(event) => onChange({ backgroundType: event.target.value as PresenterSettings['backgroundType'] })}
                >
                  <option value="solid">Solid</option>
                  <option value="gradient">Gradient</option>
                </select>
              </label>
              <label className="cw-settings__toggle">
                <input
                  type="checkbox"
                  checked={settings.axisLabelsEnabled}
                  onChange={(event) => onChange({ axisLabelsEnabled: event.target.checked })}
                />
                <span>Show Axis Labels</span>
              </label>
              <label className="cw-settings__toggle">
                <span>Axis Label Mode</span>
                <select
                  value={settings.axisLabelsMode}
                  onChange={(event) => onChange({ axisLabelsMode: event.target.value as PresenterSettings['axisLabelsMode'] })}
                  disabled={!settings.axisLabelsEnabled}
                >
                  <option value="overlay">Screen Overlay</option>
                  <option value="3d">3D Labels</option>
                </select>
              </label>
            </div>
            <div className="cw-settings__inputs">
              <label className="cw-settings__input" data-disabled={!settings.axisLabelsEnabled}>
                <span>Axis Start Date</span>
                <input
                  type="date"
                  value={settings.axisLabelsStartDate}
                  onChange={(event) => onChange({ axisLabelsStartDate: event.target.value })}
                  disabled={!settings.axisLabelsEnabled}
                />
              </label>
              <label className="cw-settings__input" data-disabled={!settings.axisLabelsEnabled}>
                <span>Axis Step (days)</span>
                <input
                  type="number"
                  min={1}
                  value={settings.axisLabelsStepDays}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    const normalized = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
                    onChange({ axisLabelsStepDays: normalized });
                  }}
                  disabled={!settings.axisLabelsEnabled}
                />
              </label>
            </div>
            <div className="cw-settings__textarea" data-disabled={!settings.axisLabelsEnabled}>
              <label>
                <span>Axis Label Template</span>
                <textarea
                  value={settings.axisLabelsTemplate}
                  onChange={(event) => onChange({ axisLabelsTemplate: event.target.value })}
                  disabled={!settings.axisLabelsEnabled}
                />
              </label>
            </div>
            {settings.billboardMode === 'html' && (
              <div className="cw-settings__textarea">
                <label>
                  <span>Billboard HTML</span>
                  <textarea
                    value={settings.billboardHtmlContent}
                    onChange={(event) => onChange({ billboardHtmlContent: event.target.value })}
                  />
                </label>
              </div>
            )}
            <div className="cw-settings__colors">
              <label className="cw-settings__color">
                <span>Ambient Color</span>
                <input
                  type="color"
                  value={settings.ambientLightColorHex}
                  onChange={(event) => onChange({ ambientLightColorHex: event.target.value })}
                />
              </label>
              <label className="cw-settings__color">
                <span>Directional Color</span>
                <input
                  type="color"
                  value={settings.directionalLightColorHex}
                  onChange={(event) => onChange({ directionalLightColorHex: event.target.value })}
                />
              </label>
              <label className="cw-settings__color">
                <span>Fill Color</span>
                <input
                  type="color"
                  value={settings.fillLightColorHex}
                  onChange={(event) => onChange({ fillLightColorHex: event.target.value })}
                  disabled={!settings.fillLightEnabled}
                />
              </label>
              <label className="cw-settings__color">
                <span>Background Solid</span>
                <input
                  type="color"
                  value={settings.backgroundSolidHex}
                  onChange={(event) => onChange({ backgroundSolidHex: event.target.value })}
                  disabled={settings.backgroundType !== 'solid'}
                />
              </label>
              <label className="cw-settings__color">
                <span>Gradient Top</span>
                <input
                  type="color"
                  value={settings.backgroundGradientTopHex}
                  onChange={(event) => onChange({ backgroundGradientTopHex: event.target.value })}
                  disabled={settings.backgroundType !== 'gradient'}
                />
              </label>
              <label className="cw-settings__color">
                <span>Gradient Bottom</span>
                <input
                  type="color"
                  value={settings.backgroundGradientBottomHex}
                  onChange={(event) => onChange({ backgroundGradientBottomHex: event.target.value })}
                  disabled={settings.backgroundType !== 'gradient'}
                />
              </label>
            </div>
            <div className="cw-settings__grid">
              {SLIDERS.map((spec) => (
                <label key={spec.key as string} className="cw-settings__control">
                  {(() => {
                    const numericValue = settings[spec.key] as number;
                    const disabled = spec.isEnabled ? !spec.isEnabled(settings) : false;
                    return (
                      <>
                        <span>{spec.label}</span>
                        <input
                          type="range"
                          min={spec.min}
                          max={spec.max}
                          step={spec.step}
                          value={numericValue}
                          onChange={handleInput(spec)}
                          disabled={disabled}
                        />
                        <span className="cw-settings__value">
                          {spec.formatter ? spec.formatter(numericValue) : numericValue}
                        </span>
                      </>
                    );
                  })()}
                </label>
              ))}
            </div>
          </motion.aside>
      )}
    </AnimatePresence>
  );
}
