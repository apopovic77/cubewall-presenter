import { useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PresenterSettings } from '../config/PresenterSettings';

interface SettingsPanelMeta {
  providerId: string;
  apiBaseUrl: string;
  storageBaseUrl: string;
  environment: string;
  lastRefreshIso: string | null;
  itemCount: number;
}

export interface SettingsPanelProps {
  isOpen: boolean;
  settings: PresenterSettings;
  onChange: (update: Partial<PresenterSettings>) => void;
  onClose: () => void;
  position: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  meta?: SettingsPanelMeta;
  onCaptureRelativeOrbit?: () => void;
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
  { key: 'waveSpeed', label: 'Wave Speed', min: 0, max: 2, step: 0.02, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.wavePositionEnabled },
  { key: 'waveAmplitudeY', label: 'Wave Height', min: 0, max: 1.5, step: 0.02, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.wavePositionEnabled },
  { key: 'waveFrequencyY', label: 'Wave Frequency', min: 0, max: 3, step: 0.01, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.wavePositionEnabled },
  { key: 'wavePhaseSpread', label: 'Wave Phase Spread', min: 0, max: 1.5, step: 0.01, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.wavePositionEnabled },
  { key: 'waveAmplitudeRot', label: 'Tilt Amplitude', min: 0, max: 1, step: 0.01, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.waveRotationEnabled },
  { key: 'waveFrequencyRot', label: 'Tilt Frequency', min: 0, max: 3, step: 0.01, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.waveRotationEnabled },
  { key: 'fieldAnimationSpeed', label: 'Field Animation Speed', min: 0, max: 3, step: 0.05, formatter: (v) => v.toFixed(2) },
  { key: 'fieldGlobalScale', label: 'Field Spread', min: 0.4, max: 3, step: 0.05, formatter: (v) => v.toFixed(2) },
  { key: 'autoSelectInterval', label: 'Auto Select Interval', min: 1, max: 30, step: 0.5, formatter: (v) => `${v.toFixed(1)}s`, isEnabled: (s) => s.autoSelectEnabled },
  { key: 'slowAutorotateSpeed', label: 'Slow Autorotate Speed', min: 0, max: 1, step: 0.01, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.slowAutorotateEnabled },
  { key: 'depthOfFieldFocusDistance', label: 'DoF Focus Distance', min: 10, max: 500, step: 5, formatter: (v) => `${Math.round(v)}`, isEnabled: (s) => s.depthOfFieldEnabled && !s.depthOfFieldAutoFocusEnabled },
  { key: 'depthOfFieldFStop', label: 'DoF f-stop', min: 0.1, max: 16, step: 0.1, formatter: (v) => v.toFixed(1), isEnabled: (s) => s.depthOfFieldEnabled },
  { key: 'depthOfFieldFocalLength', label: 'DoF Focal Length', min: 1, max: 300, step: 1, formatter: (v) => `${Math.round(v)}mm`, isEnabled: (s) => s.depthOfFieldEnabled },
  { key: 'depthOfFieldAutoFocusOffset', label: 'DoF Auto Focus Offset', min: -3, max: 3, step: 0.01, formatter: (v) => `${v.toFixed(2)}`, isEnabled: (s) => s.depthOfFieldEnabled && s.depthOfFieldAutoFocusEnabled },
  { key: 'depthOfFieldAutoFocusSharpness', label: 'DoF Sharpness Scale', min: 0.1, max: 3, step: 0.05, formatter: (v) => `${v.toFixed(2)}x`, isEnabled: (s) => s.depthOfFieldEnabled && s.depthOfFieldAutoFocusEnabled },
  { key: 'interactionRadius', label: 'Ripple Radius', min: 1, max: 8, step: 0.1, formatter: (v) => v.toFixed(1) },
  { key: 'interactionLift', label: 'Ripple Lift', min: 0, max: 2.5, step: 0.05, formatter: (v) => v.toFixed(2) },
  { key: 'selectedCubeRotation', label: 'Selected Spin', min: 0, max: Math.PI, step: 0.05, formatter: (v) => `${(v * 180 / Math.PI).toFixed(0)}°`, isEnabled: (s) => s.waveRotationEnabled },
  { key: 'selectedCubeLift', label: 'Selected Lift', min: 0, max: 10, step: 0.1, formatter: (v) => v.toFixed(1) },
  {
    key: 'tileDepth',
    label: 'Tile Depth',
    min: 0.01,
    max: 1,
    step: 0.01,
    formatter: (v) => v.toFixed(2),
    isEnabled: (s) => s.geometryMode === 'tile',
  },
  {
    key: 'textTileWidth',
    label: 'Text Tile Width',
    min: 0.4,
    max: 3,
    step: 0.05,
    formatter: (v) => v.toFixed(2),
    isEnabled: (s) => s.geometryMode === 'tile',
  },
  {
    key: 'textTileVerticalGap',
    label: 'Text Tile Gap',
    min: 0,
    max: 0.8,
    step: 0.01,
    formatter: (v) => v.toFixed(2),
    isEnabled: (s) => s.geometryMode === 'tile',
  },
  {
    key: 'textTileGlassAlpha',
    label: 'Text Tile Alpha',
    min: 0.05,
    max: 1,
    step: 0.01,
    formatter: (v) => v.toFixed(2),
    isEnabled: (s) => s.geometryMode === 'tile',
  },
  {
    key: 'masonryColumnCount',
    label: 'Masonry Columns',
    min: 1,
    max: 10,
    step: 1,
    formatter: (v) => `${Math.round(v)}`,
    isEnabled: (s) => s.geometryMode === 'tile',
  },
  {
    key: 'masonryColumnSpacing',
    label: 'Masonry Column Spacing',
    min: 0,
    max: 1,
    step: 0.01,
    formatter: (v) => v.toFixed(2),
    isEnabled: (s) => s.geometryMode === 'tile',
  },
  {
    key: 'masonryRowSpacing',
    label: 'Masonry Row Spacing',
    min: 0,
    max: 1,
    step: 0.01,
    formatter: (v) => v.toFixed(2),
    isEnabled: (s) => s.geometryMode === 'tile',
  },
  {
    key: 'physicsSelectedRotationSpeed',
    label: 'Physics Spin Speed',
    min: 0,
    max: Math.PI * 4,
    step: 0.05,
    formatter: (v) => `${(v * 180 / Math.PI).toFixed(0)}°/s`,
    isEnabled: (s) => s.physicsSelectedRotationMode === 'animated',
  },
  {
    key: 'physicsLiftSpeed',
    label: 'Physics Lift Speed',
    min: 0.2,
    max: 4,
    step: 0.05,
    formatter: (v) => v.toFixed(2),
  },
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
  { key: 'cameraAutoOrbitSpeed', label: 'Auto Orbit Speed (rad/s)', min: 0, max: 2, step: 0.01, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.cameraAutoOrbitEnabled && s.selectionCameraFollowEnabled },
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
  {
    key: 'billboardConnectorThicknessPx',
    label: 'Connector Thickness (px)',
    min: 1,
    max: 20,
    step: 0.5,
    formatter: (v) => v.toFixed(1),
    isEnabled: (s) => s.billboardMode === 'html' && s.billboardConnectorMode !== 'htmlSvg',
  },
  {
    key: 'billboardConnectorFeatherPx',
    label: 'Connector Feather (px)',
    min: 0,
    max: 6,
    step: 0.1,
    formatter: (v) => v.toFixed(1),
    isEnabled: (s) => s.billboardMode === 'html' && s.billboardConnectorMode === 'screenSpace',
  },
  { key: 'axisLabelsOffsetX', label: 'Axis Offset X', min: -5, max: 5, step: 0.05, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.axisLabelsEnabled },
  { key: 'axisLabelsOffsetY', label: 'Axis Offset Y', min: -5, max: 5, step: 0.05, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.axisLabelsEnabled },
  { key: 'axisLabelsOffsetZ', label: 'Axis Offset Z', min: -5, max: 5, step: 0.05, formatter: (v) => v.toFixed(2), isEnabled: (s) => s.axisLabelsEnabled },
];

function formatTimestamp(iso?: string | null): string {
  if (!iso) {
    return '–';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
}

export function SettingsPanel({ isOpen, settings, onChange, onClose, position, onPositionChange, meta, onCaptureRelativeOrbit }: SettingsPanelProps) {
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

  const [activeSection, setActiveSection] = useState<string>('general');

  const sliderMap = useMemo(() => {
    const lookup = new Map<keyof PresenterSettings, SliderSpec>();
    SLIDERS.forEach((spec) => lookup.set(spec.key, spec));
    return lookup;
  }, []);

  const renderSliderControl = (key: keyof PresenterSettings) => {
    const spec = sliderMap.get(key);
    if (!spec) {
      return null;
    }
    const numericValue = settings[key] as number;
    const disabled = spec.isEnabled ? !spec.isEnabled(settings) : false;
    return (
      <label key={key as string} className="cw-settings__control" data-disabled={disabled}>
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
      </label>
    );
  };

  const renderSliderGroup = (keys: Array<keyof PresenterSettings>) => {
    const rendered = keys
      .map((key) => renderSliderControl(key))
      .filter((element): element is ReactElement => Boolean(element));
    if (rendered.length === 0) {
      return null;
    }
    return <div className="cw-settings__grid">{rendered}</div>;
  };

  const toggleSection = (id: string) => {
    setActiveSection((prev) => (prev === id ? '' : id));
  };

  const sections = [
    {
      id: 'general',
      title: 'General',
      content: (
        <>
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
                checked={settings.useFallbackImages}
                onChange={(event) => onChange({ useFallbackImages: event.target.checked })}
              />
              <span>Use Static Fallback Textures</span>
            </label>
          </div>
          {renderSliderGroup([
            'gridSize',
            'fieldAnimationSpeed',
            'fieldGlobalScale',
            'autoSelectInterval',
            'interactionRadius',
            'interactionLift',
          ])}
        </>
      ),
    },
    {
      id: 'geometry',
      title: 'Geometry & Waves',
      content: (
        <>
          <div className="cw-settings__toggles">
            <label className="cw-settings__toggle">
              <span>Pop-Out Direction</span>
              <select
                value={settings.selectedCubeNormalDirection}
                onChange={(event) =>
                  onChange({
                    selectedCubeNormalDirection: Number(event.target.value) as PresenterSettings['selectedCubeNormalDirection'],
                  })
                }
              >
                <option value={1}>Along plane normal</option>
                <option value={-1}>Opposite normal (mirror)</option>
              </select>
            </label>
            <label className="cw-settings__toggle">
              <span>Geometry Mode</span>
              <select
                value={settings.geometryMode}
                onChange={(event) =>
                  onChange({
                    geometryMode: event.target.value as PresenterSettings['geometryMode'],
                    _internalAllowGeometryModeChange: true,
                  } as Partial<PresenterSettings>)
                }
              >
                <option value="cube">Cubes</option>
                <option value="tile">Tiles</option>
              </select>
            </label>
            <label className="cw-settings__toggle">
              <span>Default Orientation</span>
              <select
                value={settings.baseOrientation}
                onChange={(event) =>
                  onChange({ baseOrientation: event.target.value as PresenterSettings['baseOrientation'] })
                }
              >
                <option value="upright">Upright (front forward)</option>
                <option value="frontUp">Front Face Up</option>
              </select>
            </label>
            <label className="cw-settings__toggle">
              <input
                type="checkbox"
                checked={settings.wavePositionEnabled}
                onChange={(event) => onChange({ wavePositionEnabled: event.target.checked })}
              />
              <span>Enable Wave Motion</span>
            </label>
            <label className="cw-settings__toggle">
              <input
                type="checkbox"
                checked={settings.waveRotationEnabled}
                onChange={(event) => onChange({ waveRotationEnabled: event.target.checked })}
              />
              <span>Enable Wave Rotation</span>
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
              <span>Texture UV Layout</span>
              <select
                value={settings.textureUvLayout}
                onChange={(event) =>
                  onChange({ textureUvLayout: event.target.value as PresenterSettings['textureUvLayout'] })
                }
              >
                <option value="standard">Standard (wrap with 90° rotation)</option>
                <option value="mirrorTopAndAlternatingSides">Mirror bottom, alternate side faces</option>
                <option value="uniformSides">Uniform side orientation (no rotation)</option>
              </select>
            </label>
          </div>
          {renderSliderGroup([
            'waveSpeed',
            'waveAmplitudeY',
            'waveFrequencyY',
            'wavePhaseSpread',
            'waveAmplitudeRot',
            'waveFrequencyRot',
            'selectedCubeRotation',
            'selectedCubeLift',
          ])}
        </>
      ),
    },
    {
      id: 'masonry',
      title: 'Tiles & Masonry',
      content: (
        <>
          <div className="cw-settings__toggles">
            <label className="cw-settings__toggle" data-disabled={settings.geometryMode !== 'tile'}>
              <span>Tile Aspect</span>
              <select
                value={settings.tileAspectMode}
                onChange={(event) =>
                  onChange({ tileAspectMode: event.target.value as PresenterSettings['tileAspectMode'] })
                }
                disabled={settings.geometryMode !== 'tile'}
              >
                <option value="image">Preserve Image Aspect</option>
                <option value="square">Square Tile</option>
              </select>
            </label>
            <label className="cw-settings__toggle" data-disabled={settings.geometryMode !== 'tile'}>
              <input
                type="checkbox"
                checked={settings.tileCaptionsEnabled}
                onChange={(event) => onChange({ tileCaptionsEnabled: event.target.checked })}
                disabled={settings.geometryMode !== 'tile'}
              />
              <span>Show Tile Captions</span>
            </label>
          </div>
          {renderSliderGroup([
            'tileDepth',
            'textTileWidth',
            'textTileVerticalGap',
            'textTileGlassAlpha',
            'masonryColumnCount',
            'masonryColumnSpacing',
            'masonryRowSpacing',
          ])}
        </>
      ),
    },
    {
      id: 'camera',
      title: 'Camera',
      content: (
        <>
          <div className="cw-settings__toggles">
            <label className="cw-settings__toggle">
              <input
                type="checkbox"
                checked={settings.selectionCameraFollowEnabled}
                onChange={(event) => onChange({ selectionCameraFollowEnabled: event.target.checked })}
              />
              <span>Camera follows selected cube</span>
            </label>
            <label className="cw-settings__toggle">
              <span>Camera Orbit Mode</span>
              <select
                value={settings.cameraOrbitMode}
                onChange={(event) =>
                  onChange({ cameraOrbitMode: event.target.value as PresenterSettings['cameraOrbitMode'] })
                }
              >
                <option value="flyTo">Fly-To Radius</option>
                <option value="relativeOffset">Relative Offset</option>
              </select>
            </label>
            <label className="cw-settings__toggle">
              <span>Camera Follow Mode</span>
              <select
                value={settings.cameraFollowMode}
                onChange={(event) =>
                  onChange({ cameraFollowMode: event.target.value as PresenterSettings['cameraFollowMode'] })
                }
                disabled={!settings.selectionCameraFollowEnabled}
              >
                <option value="focusOnce">Focus on Selection</option>
                <option value="continuous">Continuous Follow</option>
              </select>
            </label>
            <label className="cw-settings__toggle">
              <input
                type="checkbox"
                checked={settings.cameraAutoOrbitEnabled}
                onChange={(event) => onChange({ cameraAutoOrbitEnabled: event.target.checked })}
                disabled={!settings.selectionCameraFollowEnabled}
              />
              <span>Auto Orbit Selected Cube</span>
            </label>
            <div className="cw-settings__toggle">
              <button
                type="button"
                onClick={onCaptureRelativeOrbit}
                disabled={!onCaptureRelativeOrbit}
              >
                Capture Relative Offset from Camera
              </button>
            </div>
            <label className="cw-settings__toggle">
              <input
                type="checkbox"
                checked={settings.useCustomCamera}
                onChange={(event) => onChange({ useCustomCamera: event.target.checked })}
              />
              <span>Use Custom Selected Camera</span>
            </label>
          </div>
          {renderSliderGroup([
            'cameraRadius',
            'flyToRadiusFactor',
            'cameraLerpSpeed',
            'cameraAnimationSpeed',
            'cameraAutoOrbitSpeed',
            'cameraOffsetX',
            'cameraOffsetY',
            'cameraOffsetZ',
            'cameraLookAtOffsetX',
            'cameraLookAtOffsetY',
            'cameraLookAtOffsetZ',
          ])}
          <div className="cw-settings__inputs" data-disabled={settings.cameraOrbitMode !== 'relativeOffset'}>
            <label className="cw-settings__input">
              <span>Relative Offset X</span>
              <input
                type="number"
                step={0.1}
                value={settings.cameraRelativeOffsetX}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value);
                  onChange({ cameraRelativeOffsetX: Number.isFinite(parsed) ? parsed : 0 });
                }}
                disabled={settings.cameraOrbitMode !== 'relativeOffset'}
              />
            </label>
            <label className="cw-settings__input">
              <span>Relative Offset Y</span>
              <input
                type="number"
                step={0.1}
                value={settings.cameraRelativeOffsetY}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value);
                  onChange({ cameraRelativeOffsetY: Number.isFinite(parsed) ? parsed : 0 });
                }}
                disabled={settings.cameraOrbitMode !== 'relativeOffset'}
              />
            </label>
            <label className="cw-settings__input">
              <span>Relative Offset Z</span>
              <input
                type="number"
                step={0.1}
                value={settings.cameraRelativeOffsetZ}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value);
                  onChange({ cameraRelativeOffsetZ: Number.isFinite(parsed) ? parsed : 0 });
                }}
                disabled={settings.cameraOrbitMode !== 'relativeOffset'}
              />
            </label>
          </div>
          <div className="cw-settings__inputs" data-disabled={settings.cameraOrbitMode !== 'relativeOffset'}>
            <label className="cw-settings__input">
              <span>LookAt Offset X</span>
              <input
                type="number"
                step={0.1}
                value={settings.cameraRelativeLookAtOffsetX}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value);
                  onChange({ cameraRelativeLookAtOffsetX: Number.isFinite(parsed) ? parsed : 0 });
                }}
                disabled={settings.cameraOrbitMode !== 'relativeOffset'}
              />
            </label>
            <label className="cw-settings__input">
              <span>LookAt Offset Y</span>
              <input
                type="number"
                step={0.1}
                value={settings.cameraRelativeLookAtOffsetY}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value);
                  onChange({ cameraRelativeLookAtOffsetY: Number.isFinite(parsed) ? parsed : 0 });
                }}
                disabled={settings.cameraOrbitMode !== 'relativeOffset'}
              />
            </label>
            <label className="cw-settings__input">
              <span>LookAt Offset Z</span>
              <input
                type="number"
                step={0.1}
                value={settings.cameraRelativeLookAtOffsetZ}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value);
                  onChange({ cameraRelativeLookAtOffsetZ: Number.isFinite(parsed) ? parsed : 0 });
                }}
                disabled={settings.cameraOrbitMode !== 'relativeOffset'}
              />
            </label>
          </div>
        </>
      ),
    },
    {
      id: 'depth-of-field',
      title: 'Depth of Field',
      content: (
        <>
          <div className="cw-settings__toggles">
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
                onChange={(event) =>
                  onChange({ depthOfFieldBlurLevel: event.target.value as PresenterSettings['depthOfFieldBlurLevel'] })
                }
                disabled={!settings.depthOfFieldEnabled}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          {renderSliderGroup([
            'depthOfFieldFocusDistance',
            'depthOfFieldFStop',
            'depthOfFieldFocalLength',
            'depthOfFieldAutoFocusOffset',
            'depthOfFieldAutoFocusSharpness',
          ])}
        </>
      ),
    },
    {
      id: 'lighting',
      title: 'Lighting & Background',
      content: (
        <>
          <div className="cw-settings__toggles">
            <label className="cw-settings__toggle">
              <input
                type="checkbox"
                checked={settings.fillLightEnabled}
                onChange={(event) => onChange({ fillLightEnabled: event.target.checked })}
              />
              <span>Enable Fill Light</span>
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
          </div>
          {renderSliderGroup([
            'ambientLightIntensity',
            'directionalLightIntensity',
            'directionalLightDirectionX',
            'directionalLightDirectionY',
            'directionalLightDirectionZ',
            'fillLightIntensity',
            'fillLightDirectionX',
            'fillLightDirectionY',
            'fillLightDirectionZ',
          ])}
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
        </>
      ),
    },
    {
      id: 'billboard',
      title: 'Billboard',
      content: (
        <>
          <div className="cw-settings__toggles">
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
            <label className="cw-settings__toggle" data-disabled={settings.billboardMode !== 'html'}>
              <span>Connector Rendering</span>
              <select
                value={settings.billboardConnectorMode}
                onChange={(event) =>
                  onChange({ billboardConnectorMode: event.target.value as PresenterSettings['billboardConnectorMode'] })
                }
                disabled={settings.billboardMode !== 'html'}
              >
                <option value="htmlSvg">Screen Overlay (SVG)</option>
                <option value="tube3d">3D Tube</option>
                <option value="screenSpace">Screen-Space Beam</option>
              </select>
            </label>
          </div>
          {renderSliderGroup([
            'billboardHeightOffset',
            'billboardDistance',
            'billboardAngleDegrees',
            'billboardConnectorThicknessPx',
            'billboardConnectorFeatherPx',
          ])}
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
        </>
      ),
    },
    {
      id: 'axis',
      title: 'Axis Labels',
      content: (
        <>
          <div className="cw-settings__toggles">
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
          {renderSliderGroup(['axisLabelsOffsetX', 'axisLabelsOffsetY', 'axisLabelsOffsetZ'])}
          <div className="cw-settings__inputs" data-disabled={!settings.axisLabelsEnabled}>
            <label className="cw-settings__input">
              <span>Axis Start Date</span>
              <input
                type="date"
                value={settings.axisLabelsStartDate}
                onChange={(event) => onChange({ axisLabelsStartDate: event.target.value })}
                disabled={!settings.axisLabelsEnabled}
              />
            </label>
            <label className="cw-settings__input">
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
        </>
      ),
    },
    {
      id: 'physics',
      title: 'Physics',
      content: (
        <>
          <div className="cw-settings__toggles">
            <label className="cw-settings__toggle">
              <span>Physics Selected Rotation</span>
              <select
                value={settings.physicsSelectedRotationMode}
                onChange={(event) =>
                  onChange({
                    physicsSelectedRotationMode: event.target.value as PresenterSettings['physicsSelectedRotationMode'],
                  })
                }
              >
                <option value="static">Static Lift</option>
                <option value="animated">Animated Spin</option>
              </select>
            </label>
          </div>
          {renderSliderGroup(['physicsSelectedRotationSpeed', 'physicsLiftSpeed'])}
        </>
      ),
    },
  ];

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
            <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={onClose}>
              Close
            </button>
            </header>
          {meta && (
            <section className="cw-settings__meta">
              <div>
                <span>API Endpoint</span>
                <strong>{meta.apiBaseUrl}</strong>
              </div>
              <div>
                <span>Storage</span>
                <strong>{meta.storageBaseUrl}</strong>
              </div>
              <div>
                <span>Provider</span>
                <strong>{meta.providerId}</strong>
              </div>
              <div>
                <span>Environment</span>
                <strong>{meta.environment}</strong>
              </div>
              <div>
                <span>Items Loaded</span>
                <strong>{meta.itemCount}</strong>
              </div>
              <div>
                <span>Last Refresh</span>
                <strong>{formatTimestamp(meta.lastRefreshIso)}</strong>
              </div>
            </section>
          )}
          <div className="cw-settings__sections">
            {sections.map((section) => (
              <div key={section.id} className="cw-settings__section">
                <button
                  type="button"
                  className="cw-settings__section-toggle"
                  onClick={() => toggleSection(section.id)}
                >
                  <span>{section.title}</span>
                  <span>{activeSection === section.id ? '−' : '+'}</span>
                </button>
                <AnimatePresence initial={false}>
                  {activeSection === section.id && (
                    <motion.div
                      key={`${section.id}-content`}
                      className="cw-settings__section-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                    >
                      <div className="cw-settings__section-inner">{section.content}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              ))}
            </div>
          </motion.aside>
      )}
    </AnimatePresence>
  );
}
