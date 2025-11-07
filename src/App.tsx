import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasStage } from './components/CanvasStage';
import { SelectionOverlay } from './components/SelectionOverlay';
import { DebugOverlay } from './components/DebugOverlay';
import { HtmlBillboard } from './components/HtmlBillboard';
import { AxisLabelsOverlay } from './components/AxisLabelsOverlay';
import { SettingsPanel } from './components/SettingsPanel';
import type { CubeSelectionInfo } from './engine/CubeField';
import type { CubeWallPresenter } from './engine/CubeWallPresenter';
import { defaultPresenterSettings, type PresenterSettings } from './config/PresenterSettings';
import { getCookie, setCookie } from './utils/cookies';
import { appConfig } from './config/AppConfig';
import type { AxisLabelDisplayState, BillboardDisplayState } from './engine/CubeWallPresenter';
import { loadServerSettings, saveServerSettings } from './utils/serverSettings';
import type { CubeContentItem } from './types/content';
import { loadCubeContent, resolveContentProviderId } from './content';

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

function loadCookieSettings(): PresenterSettings {
  const cookieValue = getCookie(SETTINGS_COOKIE_KEY);
  if (!cookieValue) {
    return { ...defaultPresenterSettings };
  }
  try {
    const parsed = JSON.parse(cookieValue);
    const sanitized = sanitizeSettings(parsed);
    if (!sanitized.billboardHtmlContent || sanitized.billboardHtmlContent === LEGACY_HTML_CONTENT) {
      sanitized.billboardHtmlContent = appConfig.billboard.htmlContent;
    }
    return sanitized;
  } catch (error) {
    console.warn('[CubeWallPresenter] Failed to parse settings cookie – falling back to defaults.', error);
    return { ...defaultPresenterSettings };
  }
}

interface InitialSettingsResult {
  settings: PresenterSettings;
  fromServer: boolean;
}

async function loadInitialSettingsAsync(): Promise<InitialSettingsResult> {
  const serverSettings = await loadServerSettings();
  if (serverSettings) {
    const sanitized = sanitizeSettings(serverSettings);
    if (!sanitized.billboardHtmlContent || sanitized.billboardHtmlContent === LEGACY_HTML_CONTENT) {
      sanitized.billboardHtmlContent = appConfig.billboard.htmlContent;
    }
    return { settings: sanitized, fromServer: true };
  }
  return { settings: loadCookieSettings(), fromServer: false };
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
  appConfig.slowAutorotateEnabled = settings.slowAutorotateEnabled;
  appConfig.slowAutorotateSpeed = settings.slowAutorotateSpeed;
  appConfig.selectionCameraFollowEnabled = settings.selectionCameraFollowEnabled;
  appConfig.depthOfFieldEnabled = settings.depthOfFieldEnabled;
  appConfig.depthOfFieldFocusDistance = settings.depthOfFieldFocusDistance;
  appConfig.depthOfFieldFStop = settings.depthOfFieldFStop;
  appConfig.depthOfFieldFocalLength = settings.depthOfFieldFocalLength;
  appConfig.depthOfFieldBlurLevel = settings.depthOfFieldBlurLevel;
  appConfig.depthOfFieldAutoFocusEnabled = settings.depthOfFieldAutoFocusEnabled;
  appConfig.depthOfFieldAutoFocusOffset = settings.depthOfFieldAutoFocusOffset;
  appConfig.depthOfFieldAutoFocusSharpness = settings.depthOfFieldAutoFocusSharpness;
  if (settings.depthOfFieldAutoFocusEnabled) {
    appConfig.depthOfFieldFocusDistance = settings.depthOfFieldFocusDistance;
    appConfig.depthOfFieldFStop = settings.depthOfFieldFStop;
  }
  appConfig.billboard.mode = settings.billboardMode;
  appConfig.billboard.htmlContent = settings.billboardHtmlContent;
  appConfig.axisLabels.enabled = settings.axisLabelsEnabled;
  appConfig.axisLabels.mode = settings.axisLabelsMode;
  appConfig.axisLabels.startDateIso = settings.axisLabelsStartDate;
  appConfig.axisLabels.stepDays = settings.axisLabelsStepDays;
  appConfig.axisLabels.template = settings.axisLabelsTemplate;
  appConfig.axisLabels.offset.x = settings.axisLabelsOffsetX;
  appConfig.axisLabels.offset.y = settings.axisLabelsOffsetY;
  appConfig.axisLabels.offset.z = settings.axisLabelsOffsetZ;
}

export default function App() {
  const [selection, setSelection] = useState<CubeSelectionInfo | null>(null);
  const [settings, setSettings] = useState<PresenterSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 24, y: 24 });
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [billboardState, setBillboardState] = useState<BillboardDisplayState | null>(null);
  const [axisLabels, setAxisLabels] = useState<AxisLabelDisplayState[]>([]);
  const [contentItems, setContentItems] = useState<CubeContentItem[]>([]);
  const hasPersistedRef = useRef(false);
  const initialSourceRef = useRef<'server' | 'cookie'>('cookie');
  const presenterRef = useRef<CubeWallPresenter | null>(null);
  const contentItemsRef = useRef<CubeContentItem[]>([]);
  const contentProviderId = resolveContentProviderId();

  useEffect(() => {
    let disposed = false;
    (async () => {
      const { settings: initial, fromServer } = await loadInitialSettingsAsync();
      if (disposed) return;
      initialSourceRef.current = fromServer ? 'server' : 'cookie';
      setSettings(initial);
    })();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await loadCubeContent(contentProviderId);
      if (cancelled) return;
      contentItemsRef.current = items;
      setContentItems(items);
      presenterRef.current?.setContent(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [contentProviderId]);

  const handleSelectionChange = useCallback((nextSelection: CubeSelectionInfo | null) => {
    setSelection(nextSelection);
  }, []);

  const handlePresenterReady = useCallback((presenter: CubeWallPresenter | null) => {
    presenterRef.current = presenter;
    if (presenter && contentItemsRef.current.length > 0) {
      presenter.setContent(contentItemsRef.current);
    }
  }, []);

  const handleSettingsChange = useCallback((update: Partial<PresenterSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...update } : prev));
  }, []);

  const handleDebugLine = useCallback((line: string) => {
    setDebugLines((prev) => [line, ...prev].slice(0, 12));
    // Mirror to console for devtools
    console.debug(`[CubeWallPresenter] ${line}`);
  }, []);

  useEffect(() => {
    if (!settings) return;
    syncConfigWithSettings(settings);
    setCookie(SETTINGS_COOKIE_KEY, JSON.stringify(settings));
    const shouldPersist = hasPersistedRef.current || initialSourceRef.current === 'cookie';
    if (shouldPersist) {
      void saveServerSettings(settings);
    }
    hasPersistedRef.current = true;
  }, [settings]);

  useEffect(() => {
    if (!settings?.axisLabelsEnabled) {
      setAxisLabels([]);
    }
  }, [settings?.axisLabelsEnabled]);

  useEffect(() => {
    if (settings?.axisLabelsMode !== 'overlay') {
      setAxisLabels([]);
    }
  }, [settings?.axisLabelsMode]);

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

  if (!settings) {
    return (
      <div className="cw-root">
        <div className="cw-loading">
          <p>Loading presenter settings…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cw-root">
      <CanvasStage
        onSelectionChange={handleSelectionChange}
        onPresenterReady={handlePresenterReady}
        settings={settings}
        onDebug={handleDebugLine}
        onBillboardStateChange={setBillboardState}
        onAxisLabelsChange={setAxisLabels}
      />
      {settings.billboardMode === 'html' && billboardState && (
        <HtmlBillboard state={billboardState} settings={settings} />
      )}
      {settings.axisLabelsEnabled && settings.axisLabelsMode === 'overlay' && axisLabels.length > 0 && (
        <AxisLabelsOverlay labels={axisLabels} />
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
