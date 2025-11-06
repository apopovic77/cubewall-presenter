import { useCallback, useEffect, useState } from 'react';
import { CanvasStage } from './components/CanvasStage';
import { SelectionOverlay } from './components/SelectionOverlay';
import { DebugOverlay } from './components/DebugOverlay';
import { HtmlBillboard } from './components/HtmlBillboard';
import { SettingsPanel } from './components/SettingsPanel';
import type { CubeSelectionInfo } from './engine/CubeField';
import { defaultPresenterSettings, type PresenterSettings } from './config/PresenterSettings';
import { getCookie, setCookie } from './utils/cookies';
import { appConfig } from './config/AppConfig';
import type { BillboardDisplayState } from './engine/CubeWallPresenter';

const SETTINGS_COOKIE_KEY = 'cwPresenterSettings';
const LEGACY_HTML_CONTENT = '<strong>Cube Info</strong><br/><em>Customize me!</em>';

function sanitizeSettings(raw: unknown): PresenterSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...defaultPresenterSettings };
  }
  const partial = raw as Partial<PresenterSettings>;
  const sanitized = { ...defaultPresenterSettings } as PresenterSettings;
  const writable = sanitized as unknown as Record<string, unknown>;
  (Object.keys(defaultPresenterSettings) as (keyof PresenterSettings)[]).forEach((key) => {
    const value = partial[key];
    if (value !== undefined) {
      writable[key as string] = value;
    }
  });
  return sanitized;
}

function loadInitialSettings(): PresenterSettings {
  const cookieValue = getCookie(SETTINGS_COOKIE_KEY);
  if (!cookieValue) {
    syncConfigWithSettings(defaultPresenterSettings);
    return { ...defaultPresenterSettings };
  }
  try {
    const parsed = JSON.parse(cookieValue);
    const sanitized = sanitizeSettings(parsed);
    if (!sanitized.billboardHtmlContent || sanitized.billboardHtmlContent === LEGACY_HTML_CONTENT) {
      sanitized.billboardHtmlContent = appConfig.billboard.htmlContent;
    }
    syncConfigWithSettings(sanitized);
    return sanitized;
  } catch (error) {
    console.warn('[CubeWallPresenter] Failed to parse settings cookie – falling back to defaults.', error);
    syncConfigWithSettings(defaultPresenterSettings);
    return { ...defaultPresenterSettings };
  }
}

function syncConfigWithSettings(settings: PresenterSettings): void {
  appConfig.gridSize = settings.gridSize;
  appConfig.useFallbackImages = settings.useFallbackImages;
  appConfig.waveSpeed = settings.waveSpeed;
  appConfig.waveAmplitudeY = settings.waveAmplitudeY;
  appConfig.waveAmplitudeRot = settings.waveAmplitudeRot;
  appConfig.interactionRadius = settings.interactionRadius;
  appConfig.interactionLift = settings.interactionLift;
  appConfig.selectedCubeRotation = settings.selectedCubeRotation;
  appConfig.selectedCubePopOutDistance = settings.selectedCubePopOutDistance;
  appConfig.selectedCubeLift = settings.selectedCubeLift;
  appConfig.camera.radius = settings.cameraRadius;
  appConfig.camera.flyToRadiusFactor = settings.flyToRadiusFactor;
  appConfig.camera.lerpSpeedFactor = settings.cameraLerpSpeed;
  appConfig.camera.useCustomView = settings.useCustomCamera;
  appConfig.camera.offset.x = settings.cameraOffsetX;
  appConfig.camera.offset.y = settings.cameraOffsetY;
  appConfig.camera.offset.z = settings.cameraOffsetZ;
  appConfig.camera.lookAtOffset.x = settings.cameraLookAtOffsetX;
  appConfig.camera.lookAtOffset.y = settings.cameraLookAtOffsetY;
  appConfig.camera.lookAtOffset.z = settings.cameraLookAtOffsetZ;
  appConfig.camera.animationSpeedFactor = settings.cameraAnimationSpeed;
  appConfig.ambientLightIntensity = settings.ambientLightIntensity;
  appConfig.ambientLightColorHex = settings.ambientLightColorHex;
  appConfig.directionalLightIntensity = settings.directionalLightIntensity;
  appConfig.directionalLightColorHex = settings.directionalLightColorHex;
  appConfig.directionalLightDirection.x = settings.directionalLightDirectionX;
  appConfig.directionalLightDirection.y = settings.directionalLightDirectionY;
  appConfig.directionalLightDirection.z = settings.directionalLightDirectionZ;
  appConfig.fillLightEnabled = settings.fillLightEnabled;
  appConfig.fillLightIntensity = settings.fillLightIntensity;
  appConfig.fillLightColorHex = settings.fillLightColorHex;
  appConfig.fillLightDirection.x = settings.fillLightDirectionX;
  appConfig.fillLightDirection.y = settings.fillLightDirectionY;
  appConfig.fillLightDirection.z = settings.fillLightDirectionZ;
  appConfig.background.type = settings.backgroundType;
  appConfig.background.solidColorHex = settings.backgroundSolidHex;
  appConfig.background.gradientTopHex = settings.backgroundGradientTopHex;
  appConfig.background.gradientBottomHex = settings.backgroundGradientBottomHex;
  appConfig.billboard.heightOffset = settings.billboardHeightOffset;
  appConfig.billboard.distance = settings.billboardDistance;
  appConfig.billboard.angleDegrees = settings.billboardAngleDegrees;
  appConfig.billboard.mode = settings.billboardMode;
  appConfig.billboard.htmlContent = settings.billboardHtmlContent;
}

export default function App() {
  const [selection, setSelection] = useState<CubeSelectionInfo | null>(null);
  const [settings, setSettings] = useState<PresenterSettings>(() => loadInitialSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 24, y: 24 });
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [billboardState, setBillboardState] = useState<BillboardDisplayState | null>(null);

  const handleSelectionChange = useCallback((nextSelection: CubeSelectionInfo | null) => {
    setSelection(nextSelection);
  }, []);

  const handleSettingsChange = useCallback((update: Partial<PresenterSettings>) => {
    setSettings((prev) => ({ ...prev, ...update }));
  }, []);

  const handleDebugLine = useCallback((line: string) => {
    setDebugLines((prev) => [line, ...prev].slice(0, 12));
    // Mirror to console for devtools
    console.debug(`[CubeWallPresenter] ${line}`);
  }, []);

  useEffect(() => {
    setCookie(SETTINGS_COOKIE_KEY, JSON.stringify(settings));
    syncConfigWithSettings(settings);
  }, [settings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        setIsSettingsOpen((prev) => !prev);
      }
      if (event.key === 'Escape') {
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="cw-root">
      <CanvasStage
        onSelectionChange={handleSelectionChange}
        settings={settings}
        onDebug={handleDebugLine}
        onBillboardStateChange={setBillboardState}
      />
      {settings.billboardMode === 'html' && billboardState && (
        <HtmlBillboard state={billboardState} settings={settings} />
      )}
      {settings.showSelectionOverlay && (
        <SelectionOverlay selection={selection} />
      )}
      <SettingsPanel
        isOpen={isSettingsOpen}
        settings={settings}
        onChange={handleSettingsChange}
        onClose={() => setIsSettingsOpen(false)}
        position={panelPosition}
        onPositionChange={setPanelPosition}
      />
      {settings.showDebugOverlay && (
        <DebugOverlay lines={debugLines} />
      )}
    </div>
  );
}
