import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasStage } from './components/CanvasStage';
import { SelectionOverlay } from './components/SelectionOverlay';
import { DebugOverlay } from './components/DebugOverlay';
import { HtmlBillboard } from './components/HtmlBillboard.tsx';
import { AxisLabelsOverlay } from './components/AxisLabelsOverlay';
import { SettingsPanel } from './components/SettingsPanel';
import { KeymapOverlay } from './components/KeymapOverlay';
import type { CubeSelectionInfo } from './engine/CubeField';
import type { CubeWallPresenter } from './engine/CubeWallPresenter';
import { defaultPresenterSettings, type PresenterSettings } from './config/PresenterSettings';
import { getCookie, setCookie } from './utils/cookies';
import {
  appConfig,
  type CubeLayoutConfig,
  type TextureUvLayout,
  type AxisLabelsMode,
  type AxisLabelAxis,
  type GeometryMode,
} from './config/AppConfig';
import type { AxisLabelDisplayState, BillboardDisplayState, BillboardScreenMetrics } from './engine/CubeWallPresenter';
import { loadServerSettings, saveServerSettings } from './utils/serverSettings';
import type { CubeContentItem } from './types/content';
import { loadCubeContent, resolveContentProviderId } from './content/registry';

const SETTINGS_COOKIE_KEY = 'cwPresenterSettings';
const ENABLE_SERVER_SETTINGS = import.meta.env.VITE_ENABLE_SETTINGS_SERVER !== 'false';
const LEGACY_HTML_CONTENT = '<strong>Cube Info</strong><br/><em>Customize me!</em>';
const LEGACY_BILLBOARD_MARKERS = [
  'nebula headline',
  'hier könnte deine subheadline',
  'cube {{gridx}}, {{gridz}}',
];

const MATRIX_LAYOUT_OVERRIDE: Partial<CubeLayoutConfig> = {
  mode: 'matrix',
};

const MASONRY_LAYOUT_OVERRIDE: Partial<CubeLayoutConfig> = {
  mode: 'masonry',
};

const AXIS_LAYOUT_OVERRIDE: Partial<CubeLayoutConfig> = {
  mode: 'axis',
  axis: 'rows',
  axisKey: 'publishedDay',
  sortOrder: 'desc',
  axisOrder: 'desc',
};

function isLegacyBillboardTemplate(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.toLowerCase().trim();
  if (!normalized) return true;
  if (normalized === LEGACY_HTML_CONTENT.toLowerCase()) return true;
  return LEGACY_BILLBOARD_MARKERS.some((marker) => normalized.includes(marker));
}

declare global {
  interface Window {
    cubewallRefreshContent?: () => Promise<void>;
    __cubewallPreload?: {
      items: CubeContentItem[];
      layout: Partial<CubeLayoutConfig> | null;
      fetchedAt: string;
    };
  }
}

function sanitizeSettings(raw: unknown): PresenterSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...defaultPresenterSettings };
  }
  const partial = raw as Partial<PresenterSettings> & {
    cubeOrientation?: PresenterSettings['baseOrientation'];
    tileOrientation?: PresenterSettings['baseOrientation'];
  };
  const sanitized = { ...defaultPresenterSettings } as PresenterSettings;
  const writable = sanitized as unknown as Record<string, unknown>;
  (Object.keys(defaultPresenterSettings) as (keyof PresenterSettings)[]).forEach((key) => {
    const value = partial[key];
    if (value !== undefined) {
      writable[key as string] = value;
    }
  });
  if (partial.cubeOrientation || partial.tileOrientation) {
    const legacy = partial.tileOrientation ?? partial.cubeOrientation;
    if (legacy === 'upright' || legacy === 'frontUp') {
      sanitized.baseOrientation = legacy;
    }
  }
  if (Math.abs(sanitized.selectedCubeRotation - Math.PI / 4) < 1e-6) {
    sanitized.selectedCubeRotation = Math.PI / 2;
  }
  if (isLegacyBillboardTemplate(sanitized.billboardHtmlContent)) {
    sanitized.billboardHtmlContent = appConfig.billboard.htmlContent;
  }
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
    if (isLegacyBillboardTemplate(sanitized.billboardHtmlContent)) {
      sanitized.billboardHtmlContent = appConfig.billboard.htmlContent;
    }
    return sanitized;
  } catch (error) {
    console.warn('[CubeWallPresenter] Failed to parse settings cookie – falling back to defaults.', error);
    return { ...defaultPresenterSettings };
  }
}

function mapUvLayout(layout: TextureUvLayout): { sidePattern: 'uniform' | 'alternating'; mirrorTopBottom: boolean } {
  switch (layout) {
    case 'mirrorTopAndAlternatingSides':
      return { sidePattern: 'alternating' as const, mirrorTopBottom: true };
    case 'uniformSides':
      return { sidePattern: 'uniform' as const, mirrorTopBottom: false };
    case 'standard':
    default:
      return { sidePattern: 'uniform' as const, mirrorTopBottom: false };
  }
}

function mergeLayoutConfig(overrides?: Partial<CubeLayoutConfig>): CubeLayoutConfig {
  const base = appConfig.layout;
  const axisKey = overrides?.axisKey && overrides.axisKey.trim() ? overrides.axisKey.trim() : base.axisKey;

  return {
    mode: overrides?.mode ?? base.mode,
    axis: overrides?.axis ?? base.axis,
    axisKey,
    sortOrder: overrides?.sortOrder ?? base.sortOrder,
    axisOrder: overrides?.axisOrder ?? base.axisOrder,
  };
}

interface InitialSettingsResult {
  settings: PresenterSettings;
  fromServer: boolean;
}

function nearlyEqual(a: number, b: number, epsilon = 0.5): boolean {
  return Math.abs(a - b) <= epsilon;
}

function shallowEqualBillboard(
  a: BillboardDisplayState | null,
  b: BillboardDisplayState | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.contentVersion !== b.contentVersion || a.isVisible !== b.isVisible) {
    return false;
  }
  if (
    !nearlyEqual(a.screenX, b.screenX) ||
    !nearlyEqual(a.screenY, b.screenY) ||
    !nearlyEqual(a.cubeScreenX, b.cubeScreenX) ||
    !nearlyEqual(a.cubeScreenY, b.cubeScreenY) ||
    a.viewportWidth !== b.viewportWidth ||
    a.viewportHeight !== b.viewportHeight
  ) {
    return false;
  }
  const ac = a.content;
  const bc = b.content;
  if (!ac && !bc) return true;
  if (!ac || !bc) return false;
  if (
    ac.gridX !== bc.gridX ||
    ac.gridZ !== bc.gridZ ||
    ac.textureLabel !== bc.textureLabel ||
    ac.item !== bc.item
  ) {
    return false;
  }
  return true;
}

function cloneBillboardState(state: BillboardDisplayState | null): BillboardDisplayState | null {
  if (!state) return null;
  return {
    ...state,
    content: state.content
      ? {
          ...state.content,
        }
      : null,
  };
}

async function loadInitialSettingsAsync(): Promise<InitialSettingsResult> {
  if (ENABLE_SERVER_SETTINGS) {
    const serverSettings = await loadServerSettings();
    if (serverSettings) {
      const sanitized = sanitizeSettings(serverSettings);
      if (!sanitized.billboardHtmlContent || sanitized.billboardHtmlContent === LEGACY_HTML_CONTENT) {
        sanitized.billboardHtmlContent = appConfig.billboard.htmlContent;
      }
      return { settings: sanitized, fromServer: true };
    }
  }
  return { settings: loadCookieSettings(), fromServer: false };
}

function syncConfigWithSettings(settings: PresenterSettings): void {
  appConfig.gridSize = settings.gridSize;
  appConfig.useFallbackImages = settings.useFallbackImages;
  appConfig.textureUvLayout = settings.textureUvLayout;
  const { sidePattern, mirrorTopBottom } = mapUvLayout(settings.textureUvLayout);
  appConfig.textureSidePattern = sidePattern;
  appConfig.textureMirrorTopBottom = mirrorTopBottom;
  appConfig.waveSpeed = settings.waveSpeed;
  appConfig.wavePositionEnabled = settings.wavePositionEnabled;
  appConfig.waveRotationEnabled = settings.waveRotationEnabled;
  appConfig.waveAmplitudeY = settings.waveAmplitudeY;
  appConfig.waveFrequencyY = settings.waveFrequencyY;
  appConfig.wavePhaseSpread = settings.wavePhaseSpread;
  appConfig.waveAmplitudeRot = settings.waveAmplitudeRot;
  appConfig.waveFrequencyRot = settings.waveFrequencyRot;
  appConfig.fieldAnimationSpeed = Math.max(0, settings.fieldAnimationSpeed);
  appConfig.fieldGlobalScale = Math.max(0.1, settings.fieldGlobalScale);
  appConfig.interactionRadius = settings.interactionRadius;
  appConfig.interactionLift = settings.interactionLift;
  appConfig.selectedCubeRotation = settings.selectedCubeRotation;
  appConfig.selectedCubePopOutDistance = settings.selectedCubePopOutDistance;
  appConfig.selectedCubeLift = settings.selectedCubeLift;
  appConfig.selectedCubeNormalDirection = settings.selectedCubeNormalDirection;
  appConfig.selectionSpinEnabled = settings.selectionSpinEnabled;
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
  appConfig.camera.orbitMode = settings.cameraOrbitMode;
  appConfig.camera.followMode = settings.cameraFollowMode;
  appConfig.camera.relativeOffset.x = settings.cameraRelativeOffsetX;
  appConfig.camera.relativeOffset.y = settings.cameraRelativeOffsetY;
  appConfig.camera.relativeOffset.z = settings.cameraRelativeOffsetZ;
  appConfig.camera.relativeLookAtOffset.x = settings.cameraRelativeLookAtOffsetX;
  appConfig.camera.relativeLookAtOffset.y = settings.cameraRelativeLookAtOffsetY;
  appConfig.camera.relativeLookAtOffset.z = settings.cameraRelativeLookAtOffsetZ;
  appConfig.camera.autoOrbitEnabled = settings.cameraAutoOrbitEnabled;
  appConfig.camera.autoOrbitSpeed = settings.cameraAutoOrbitSpeed;
  appConfig.physicsSelectedRotationMode = settings.physicsSelectedRotationMode;
  appConfig.physicsSelectedRotationSpeed = settings.physicsSelectedRotationSpeed;
  appConfig.geometryMode = settings.geometryMode;
  appConfig.tileDepth = settings.tileDepth;
  appConfig.tileAspectMode = settings.tileAspectMode;
  appConfig.baseOrientation = settings.baseOrientation;
  appConfig.tiles.captionsEnabled = settings.tileCaptionsEnabled;
  appConfig.tiles.text.tileWidth = Math.max(0.2, settings.textTileWidth);
  appConfig.tiles.text.verticalGap = Math.max(0, settings.textTileVerticalGap);
  appConfig.tiles.text.glassAlpha = Math.min(Math.max(settings.textTileGlassAlpha, 0), 1);
  appConfig.masonry.columnCount = Math.max(1, Math.round(settings.masonryColumnCount));
  appConfig.masonry.columnSpacing = Math.max(0, settings.masonryColumnSpacing);
  appConfig.masonry.rowSpacing = Math.max(0, settings.masonryRowSpacing);
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
  appConfig.billboard.connectorMode = settings.billboardConnectorMode;
  appConfig.billboard.connectorThicknessPx = settings.billboardConnectorThicknessPx;
  appConfig.billboard.connectorFeatherPx = settings.billboardConnectorFeatherPx;
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
  const [contentStatus, setContentStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [contentSummary, setContentSummary] = useState<string>('');
  const hasPersistedRef = useRef(false);
  const initialSourceRef = useRef<'server' | 'cookie'>('cookie');
  const presenterRef = useRef<CubeWallPresenter | null>(null);
  const contentItemsRef = useRef<CubeContentItem[]>([]);
  const contentLayoutRef = useRef<Partial<CubeLayoutConfig> | null>(null);
  const settingsRef = useRef<PresenterSettings | null>(null);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const layoutOverrideRef = useRef<Partial<CubeLayoutConfig> | null>(null);
  const preloadDataRef = useRef(window.__cubewallPreload ?? null);
  const [layoutOverride, setLayoutOverride] = useState<Partial<CubeLayoutConfig> | null>(null);
  const [contentStats, setContentStats] = useState<{ itemCount: number; lastRefreshIso: string | null }>({
    itemCount: 0,
    lastRefreshIso: null,
  });
  const axisLabelStateRef = useRef<{
    enabled: boolean;
    mode: AxisLabelsMode;
    template: string;
    axes: AxisLabelAxis[] | undefined;
  } | null>(null);
  const contentProviderId = resolveContentProviderId();
  const enablePicsumFallbacks = import.meta.env.VITE_ENABLE_PICSUM_FALLBACKS === 'true';
  const enableBaseFallbackTextures = import.meta.env.VITE_ENABLE_BASE_FALLBACK_TEXTURES !== 'false';
  appConfig.useFallbackImages = enableBaseFallbackTextures;
  const billboardStateRef = useRef<BillboardDisplayState | null>(null);

  const apiBaseUrl = useMemo(() => {
    const explicit = (import.meta.env.VITE_KORALMBAHN_API_URL as string | undefined)?.trim();
    if (explicit) {
      return explicit.replace(/\/$/, '');
    }
    if (import.meta.env.DEV) {
      return 'http://localhost:8080';
    }
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin.replace(/\/$/, '');
    }
    return '';
  }, []);

  const storageBaseUrl = useMemo(() => {
    const explicit = (import.meta.env.VITE_KORALMBAHN_STORAGE_URL as string | undefined)?.trim();
    if (explicit) {
      return explicit.replace(/\/+$/, '');
    }
    return 'https://api-storage.arkturian.com';
  }, []);

  useEffect(() => {
    let disposed = false;
    (async () => {
      console.info('[CubeWallInit] Loading initial presenter settings …');
      const { settings: initial, fromServer } = await loadInitialSettingsAsync();
      if (disposed) return;
      initialSourceRef.current = fromServer ? 'server' : 'cookie';
      setSettings(initial);
      console.info('[CubeWallInit] Initial settings ready.', { fromServer });
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const applyContentToPresenter = useCallback(
    async (items: CubeContentItem[], providerLayout?: Partial<CubeLayoutConfig>) => {
      console.info('[CubeWallInit] applyContentToPresenter', {
        items: items.length,
        presenterReady: Boolean(presenterRef.current),
      });
      const presenter = presenterRef.current;
      if (!presenter) {
        console.warn('[CubeWallInit] Presenter not ready; skipping applyContentToPresenter.');
        return;
      }

      const provider = contentProviderId;
      const currentSettings = settingsRef.current ?? defaultPresenterSettings;
      const { sidePattern, mirrorTopBottom } = mapUvLayout(currentSettings.textureUvLayout);
      const combinedLayoutOverrides: Partial<CubeLayoutConfig> = {
        ...(providerLayout ?? {}),
        ...(layoutOverrideRef.current ?? {}),
      };

      await presenter.setContent(items, {
        repeatContent: provider === 'default',
        useFallbackTextures: enableBaseFallbackTextures && provider === 'default',
        useDynamicFallbacks: enableBaseFallbackTextures && provider === 'default' && enablePicsumFallbacks,
        sidePattern,
        mirrorTopBottom,
        uvLayout: currentSettings.textureUvLayout,
        layout: mergeLayoutConfig(combinedLayoutOverrides),
      });
      console.info('[CubeWallInit] Content forwarded to presenter.');
    },
    [contentProviderId, enableBaseFallbackTextures, enablePicsumFallbacks],
  );

  const refreshContent = useCallback(async () => {
    const controller = new AbortController();
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = controller;

    setContentStatus('loading');
    try {
      console.info('[CubeWallInit] refreshContent -> fetching content …');
      const payload = await loadCubeContent(contentProviderId);
      if (controller.signal.aborted) {
        console.warn('[CubeWallInit] refreshContent aborted (signal).');
        return;
      }
      contentItemsRef.current = payload.items;
      contentLayoutRef.current = payload.layout ?? null;
      setContentStats({
        itemCount: payload.items.length,
        lastRefreshIso: new Date().toISOString(),
      });
      setContentSummary(
        `provider=${contentProviderId}, items=${payload.items.length}, layout=${payload.layout ? 'yes' : 'no'}`,
      );
      if (payload.items.length > 0) {
        if (presenterRef.current) {
      await applyContentToPresenter(payload.items, payload.layout ?? undefined);
        }
        setContentStatus('ready');
        console.info('[CubeWallInit] refreshContent succeeded with items.', { count: payload.items.length });
      } else {
        console.warn('[CubeWallInit] refreshContent returned zero items.');
        setContentStatus('empty');
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[CubeWallPresenter] Failed to refresh content', error);
      setContentSummary(`error: ${error instanceof Error ? error.message : String(error)}`);
      setContentStatus('error');
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
      }
    }
  }, [applyContentToPresenter, contentProviderId]);

  useEffect(() => {
    const preload = preloadDataRef.current;
    if (preload) {
      console.info('[CubeWallInit] Preload dataset detected.', {
        items: preload.items.length,
        layout: Boolean(preload.layout),
      });
      contentItemsRef.current = preload.items;
      contentLayoutRef.current = preload.layout;
      setContentStats({
        itemCount: preload.items.length,
        lastRefreshIso: preload.fetchedAt,
      });
      setContentSummary(
        `provider=${contentProviderId}, items=${preload.items.length}, layout=${preload.layout ? 'yes' : 'no'} (cached)`,
      );
      preloadDataRef.current = null;
      if (preload.items.length > 0) {
        if (presenterRef.current) {
          void applyContentToPresenter(preload.items, preload.layout ?? undefined);
        } else {
          console.warn('[CubeWallInit] Presenter not ready yet while applying preload content.');
        }
        setContentStatus('ready');
      } else {
        console.warn('[CubeWallInit] Preload dataset contained zero items.');
        setContentStatus('empty');
      }
    } else {
      console.info('[CubeWallInit] No preload dataset, fetching content.');
      setContentStatus('loading');
      void refreshContent();
    }
    return () => {
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
    };
  }, [refreshContent, applyContentToPresenter]);

  useEffect(() => {
    const handler = () => {
      void refreshContent();
    };
    const refreshFn = () => refreshContent();
    window.addEventListener('cubewall:refresh-content', handler);
    window.cubewallRefreshContent = refreshFn;
    return () => {
      window.removeEventListener('cubewall:refresh-content', handler);
      if (window.cubewallRefreshContent === refreshFn) {
        Reflect.deleteProperty(window, 'cubewallRefreshContent');
      }
    };
  }, [refreshContent]);

  const handleSelectionChange = useCallback((nextSelection: CubeSelectionInfo | null) => {
    setSelection(nextSelection);
  }, []);

  const lastBillboardMetricsRef = useRef<BillboardScreenMetrics | null>(null);

  const metricsNearlyEqual = useCallback(
    (a: BillboardScreenMetrics | null, b: BillboardScreenMetrics | null): boolean => {
      if (a === b) return true;
      if (!a || !b) return false;
      const threshold = 0.5;
      return (
        Math.abs(a.left - b.left) < threshold &&
        Math.abs(a.top - b.top) < threshold &&
        Math.abs(a.width - b.width) < threshold &&
        Math.abs(a.height - b.height) < threshold &&
        Math.abs(a.centerX - b.centerX) < threshold &&
        Math.abs(a.centerY - b.centerY) < threshold
      );
    },
    [],
  );

  const handleBillboardLayout = useCallback(
    (metrics: BillboardScreenMetrics | null) => {
      const prev = lastBillboardMetricsRef.current;
      if (metricsNearlyEqual(prev, metrics)) {
        return;
      }
      lastBillboardMetricsRef.current = metrics
        ? {
            left: metrics.left,
            top: metrics.top,
            width: metrics.width,
            height: metrics.height,
            centerX: metrics.centerX,
            centerY: metrics.centerY,
          }
        : null;
      presenterRef.current?.updateBillboardScreenMetrics(metrics);
    },
    [metricsNearlyEqual],
  );

  useEffect(() => {
    if (!presenterRef.current) return;
    if (contentItemsRef.current.length === 0) return;
    console.info('[CubeWallInit] Presenter ready & applying buffered content.', {
      items: contentItemsRef.current.length,
    });
    void applyContentToPresenter(contentItemsRef.current, contentLayoutRef.current ?? undefined);
  }, [applyContentToPresenter]);

  const handlePresenterReady = useCallback((presenter: CubeWallPresenter | null) => {
    console.info('[CubeWallInit] handlePresenterReady', { presenterReady: Boolean(presenter) });
    presenterRef.current = presenter;
    if (presenter && contentItemsRef.current.length > 0) {
      console.info('[CubeWallInit] handlePresenterReady applying buffered items.');
      void applyContentToPresenter(contentItemsRef.current, contentLayoutRef.current ?? undefined);
    } else if (presenter) {
      console.warn('[CubeWallInit] handlePresenterReady – presenter ready but no items buffered yet.');
    }
  }, [applyContentToPresenter]);

  const handleSettingsChange = useCallback((update: Partial<PresenterSettings>) => {
    const internalUpdate = update as Partial<PresenterSettings> & {
      _internalAllowGeometryModeChange?: boolean;
    };
    setSettings((prev) => {
      if (!prev) return prev;
      if (
        'geometryMode' in internalUpdate &&
        internalUpdate.geometryMode &&
        prev.geometryMode === 'tile' &&
        internalUpdate.geometryMode !== 'tile' &&
        !internalUpdate._internalAllowGeometryModeChange
      ) {
        const { _internalAllowGeometryModeChange, geometryMode: _ignored, ...rest } = internalUpdate;
        console.warn(
          '[CubeWallPresenter] Prevented external geometry mode change while tile captions are active.',
          { attemptedMode: update.geometryMode },
        );
        return { ...prev, ...rest };
      }
      const { _internalAllowGeometryModeChange, ...rest } = internalUpdate;
      return { ...prev, ...rest };
    });
  }, []);

  const handleCaptureRelativeCamera = useCallback(() => {
    const presenter = presenterRef.current;
    if (!presenter) return;
    const capture = presenter.captureCameraRelativeOffset();
    if (!capture) return;
    handleSettingsChange({
      cameraRelativeOffsetX: capture.offset.x,
      cameraRelativeOffsetY: capture.offset.y,
      cameraRelativeOffsetZ: capture.offset.z,
      cameraRelativeLookAtOffsetX: capture.lookAtOffset.x,
      cameraRelativeLookAtOffsetY: capture.lookAtOffset.y,
      cameraRelativeLookAtOffsetZ: capture.lookAtOffset.z,
    });
  }, [handleSettingsChange]);

  const handleDebugLine = useCallback((line: string) => {
    setDebugLines((prev) => [line, ...prev].slice(0, 12));
    // Mirror to console for devtools
    console.debug(`[CubeWallPresenter] ${line}`);
  }, []);

  const toggleGeometryMode = useCallback(() => {
    const currentGeometry = settingsRef.current?.geometryMode ?? appConfig.geometryMode;
    const nextGeometry: GeometryMode = currentGeometry === 'tile' ? 'cube' : 'tile';
    handleSettingsChange({
      geometryMode: nextGeometry,
      _internalAllowGeometryModeChange: true,
    } as Partial<PresenterSettings>);
    layoutOverrideRef.current = null;
    setLayoutOverride(null);
    console.info(
      `[CubeWallPresenter] Geometry mode set to ${nextGeometry === 'tile' ? 'tile' : 'cube'} via shortcut.`,
    );
  }, [handleSettingsChange, setLayoutOverride]);

  const applyLayoutPreset = useCallback(
    (preset: Partial<CubeLayoutConfig>) => {
      const previousMode =
        layoutOverrideRef.current?.mode ??
        contentLayoutRef.current?.mode ??
        appConfig.layout.mode;
      const nextMode = preset.mode ?? previousMode;

      if (nextMode === 'axis') {
        setSettings((prev) => {
          if (!prev) return prev;
          if (!axisLabelStateRef.current) {
            axisLabelStateRef.current = {
              enabled: prev.axisLabelsEnabled,
              mode: prev.axisLabelsMode,
              template: prev.axisLabelsTemplate,
              axes: appConfig.axisLabels.axes ? [...appConfig.axisLabels.axes] : undefined,
            };
          }
          return {
            ...prev,
            axisLabelsEnabled: true,
            axisLabelsMode: 'overlay',
            axisLabelsTemplate: '{{value}}',
          };
        });
        appConfig.axisLabels.enabled = true;
        appConfig.axisLabels.mode = 'overlay';
        appConfig.axisLabels.template = '{{value}}';
        appConfig.axisLabels.axes = ['rows'];
      } else if (previousMode === 'axis') {
        const previous = axisLabelStateRef.current;
        setSettings((prev) => {
          if (!prev) return prev;
          if (!previous) {
            return {
              ...prev,
              axisLabelsEnabled: defaultPresenterSettings.axisLabelsEnabled,
              axisLabelsMode: defaultPresenterSettings.axisLabelsMode,
              axisLabelsTemplate: defaultPresenterSettings.axisLabelsTemplate,
            };
          }
          return {
            ...prev,
            axisLabelsEnabled: previous.enabled,
            axisLabelsMode: previous.mode,
            axisLabelsTemplate: previous.template,
          };
        });
        if (previous) {
          appConfig.axisLabels.enabled = previous.enabled;
          appConfig.axisLabels.mode = previous.mode;
          appConfig.axisLabels.template = previous.template;
          appConfig.axisLabels.axes = previous.axes ?? ['rows'];
        } else {
          appConfig.axisLabels.enabled = defaultPresenterSettings.axisLabelsEnabled;
          appConfig.axisLabels.mode = defaultPresenterSettings.axisLabelsMode;
          appConfig.axisLabels.template = defaultPresenterSettings.axisLabelsTemplate;
          appConfig.axisLabels.axes = ['rows'];
        }
        axisLabelStateRef.current = null;
      }

      const presetCopy: Partial<CubeLayoutConfig> = { ...preset };
      if (presetCopy.mode === 'masonry') {
        appConfig.masonry.columnCount = Math.max(
          1,
          Math.round(settingsRef.current?.masonryColumnCount ?? appConfig.masonry.columnCount),
        );
        if (settingsRef.current?.geometryMode !== 'tile') {
          handleSettingsChange({
            geometryMode: 'tile',
            _internalAllowGeometryModeChange: true,
          } as Partial<PresenterSettings>);
        }
      }
      layoutOverrideRef.current = presetCopy;
      setLayoutOverride(presetCopy);
      if (presetCopy.mode) {
        appConfig.layout.mode = presetCopy.mode;
      }
      presenterRef.current?.markAxisLabelsDirty();
      if (presenterRef.current && contentItemsRef.current.length > 0) {
        void applyContentToPresenter(
          contentItemsRef.current,
          contentLayoutRef.current ?? undefined,
        );
        if (presetCopy.mode === 'axis') {
          presenterRef.current.debugAxisSummary();
        }
      }
    },
    [applyContentToPresenter, handleSettingsChange, setLayoutOverride],
  );

  const handleRetryLoad = useCallback(() => {
    setContentStatus('loading');
    void refreshContent();
  }, [refreshContent]);

  const prevGeometryModeRef = useRef<GeometryMode | null>(null);

  useEffect(() => {
    if (!settings) return;
    syncConfigWithSettings(settings);
    setCookie(SETTINGS_COOKIE_KEY, JSON.stringify(settings));
    const shouldPersist = hasPersistedRef.current || initialSourceRef.current === 'cookie';
    if (ENABLE_SERVER_SETTINGS && shouldPersist) {
      void saveServerSettings(settings);
    }
    hasPersistedRef.current = true;

    const prevGeometry = prevGeometryModeRef.current;
    if (prevGeometry !== null && prevGeometry !== settings.geometryMode) {
      if (presenterRef.current && contentItemsRef.current.length > 0) {
        console.info(
          `[CubeWallPresenter] Geometry mode changed ${prevGeometry} -> ${settings.geometryMode}, refreshing content.`,
        );
        void applyContentToPresenter(contentItemsRef.current, contentLayoutRef.current ?? undefined);
      }
    }
    prevGeometryModeRef.current = settings.geometryMode;
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
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    layoutOverrideRef.current = layoutOverride;
    if (presenterRef.current && contentItemsRef.current.length > 0) {
      void applyContentToPresenter(contentItemsRef.current, contentLayoutRef.current ?? undefined);
    }
  }, [layoutOverride, applyContentToPresenter]);

  useEffect(() => {
    if (!billboardState) {
      handleBillboardLayout(null);
    }
  }, [billboardState, handleBillboardLayout]);

  const panelMeta = useMemo(
    () => ({
      providerId: contentProviderId,
      apiBaseUrl,
      storageBaseUrl,
      environment: import.meta.env.MODE ?? 'unknown',
      lastRefreshIso: contentStats.lastRefreshIso,
      itemCount: contentStats.itemCount,
    }),
    [apiBaseUrl, contentProviderId, contentStats.itemCount, contentStats.lastRefreshIso, storageBaseUrl],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === '1') {
        event.preventDefault();
        toggleGeometryMode();
        return;
      }
      if (event.key === '2') {
        event.preventDefault();
        let nextWavePosition = false;
        setSettings((prev) => {
          if (!prev) return prev;
          nextWavePosition = !prev.wavePositionEnabled;
          return {
            ...prev,
            wavePositionEnabled: nextWavePosition,
          };
        });
        console.info(
          `[CubeWallPresenter] Wave motion ${nextWavePosition ? 'enabled' : 'disabled'} via shortcut.`,
        );
        return;
      }
      if (event.key === '3') {
        event.preventDefault();
        let nextWaveRotation = false;
        setSettings((prev) => {
          if (!prev) return prev;
          nextWaveRotation = !prev.waveRotationEnabled;
          return {
            ...prev,
            waveRotationEnabled: nextWaveRotation,
          };
        });
        console.info(
          `[CubeWallPresenter] Wave rotation ${nextWaveRotation ? 'enabled' : 'disabled'} via shortcut.`,
        );
        return;
      }
      if (event.key === '4') {
        event.preventDefault();
        console.debug('[CubeWallPresenter] Layout preset -> matrix (shortcut)');
        applyLayoutPreset(MATRIX_LAYOUT_OVERRIDE);
        return;
      }
      if (event.key === '5') {
        event.preventDefault();
        console.debug('[CubeWallPresenter] Layout preset -> masonry (shortcut)');
        applyLayoutPreset(MASONRY_LAYOUT_OVERRIDE);
        return;
      }
      if (event.key === 'F1') {
        event.preventDefault();
        setIsSettingsOpen((prev) => !prev);
      }
      if (event.key === 'Escape') {
        setIsSettingsOpen(false);
      }
      if (event.key === 'F3') {
        event.preventDefault();
        void presenterRef.current?.triggerPhysicsDrop();
      }
      if (event.key === 'F4') {
        event.preventDefault();
        const currentMode =
          layoutOverrideRef.current?.mode ??
          contentLayoutRef.current?.mode ??
          appConfig.layout.mode;
        const next = currentMode === 'axis' ? MATRIX_LAYOUT_OVERRIDE : AXIS_LAYOUT_OVERRIDE;
        console.debug(
          `[CubeWallPresenter] Layout toggle -> ${
            next.mode === 'axis' ? 'axis (rows by publishedDay)' : 'matrix (default)'
          }`,
        );
        applyLayoutPreset(next);
        return;
      }
      if (event.key === 'F6') {
        event.preventDefault();
        if (event.shiftKey || !appConfig.fieldSystemV2Enabled) {
          presenterRef.current?.randomizeFieldOrientation();
        } else {
          presenterRef.current?.toggleFieldAutoRotation();
        }
      }
      if (event.key === 'F7') {
        event.preventDefault();
        presenterRef.current?.startFieldMorph();
      }
      if (event.key === 'F8') {
        event.preventDefault();
        presenterRef.current?.triggerLineWaveField();
      }
      if (event.key === 'F9') {
        event.preventDefault();
        if (event.shiftKey) {
          setSettings((prev) => {
            if (!prev) return prev;
            const defaults = defaultPresenterSettings;
            const next: PresenterSettings = {
              ...prev,
              cameraOrbitMode: defaults.cameraOrbitMode,
              cameraFollowMode: defaults.cameraFollowMode,
              useCustomCamera: defaults.useCustomCamera,
              cameraOffsetX: defaults.cameraOffsetX,
              cameraOffsetY: defaults.cameraOffsetY,
              cameraOffsetZ: defaults.cameraOffsetZ,
              cameraLookAtOffsetX: defaults.cameraLookAtOffsetX,
              cameraLookAtOffsetY: defaults.cameraLookAtOffsetY,
              cameraLookAtOffsetZ: defaults.cameraLookAtOffsetZ,
              cameraRelativeOffsetX: defaults.cameraRelativeOffsetX,
              cameraRelativeOffsetY: defaults.cameraRelativeOffsetY,
              cameraRelativeOffsetZ: defaults.cameraRelativeOffsetZ,
              cameraRelativeLookAtOffsetX: defaults.cameraRelativeLookAtOffsetX,
              cameraRelativeLookAtOffsetY: defaults.cameraRelativeLookAtOffsetY,
              cameraRelativeLookAtOffsetZ: defaults.cameraRelativeLookAtOffsetZ,
              cameraRadius: defaults.cameraRadius,
              flyToRadiusFactor: defaults.flyToRadiusFactor,
              cameraLerpSpeed: defaults.cameraLerpSpeed,
              cameraAnimationSpeed: defaults.cameraAnimationSpeed,
              cameraAutoOrbitEnabled: defaults.cameraAutoOrbitEnabled,
              cameraAutoOrbitSpeed: defaults.cameraAutoOrbitSpeed,
            };
            queueMicrotask(() => {
              presenterRef.current?.resetCameraToDefaults();
              presenterRef.current?.selectNextCube(true);
            });
            return next;
          });
          return;
        }
        toggleGeometryMode();
        return;
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        presenterRef.current?.selectNextCube();
        return;
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        presenterRef.current?.selectRandomCube();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyLayoutPreset, toggleGeometryMode]);

  const effectiveLayoutMode =
    layoutOverride?.mode ??
    contentLayoutRef.current?.mode ??
    appConfig.layout.mode;
  const geometryMode = settings?.geometryMode ?? defaultPresenterSettings.geometryMode;
  const wavePositionEnabled =
    settings?.wavePositionEnabled ?? defaultPresenterSettings.wavePositionEnabled;
  const waveRotationEnabled =
    settings?.waveRotationEnabled ?? defaultPresenterSettings.waveRotationEnabled;
  const physicsActive = presenterRef.current?.isPhysicsActive?.() ?? false;

  const handleBillboardStateChange = useCallback(
    (next: BillboardDisplayState | null) => {
      const prev = billboardStateRef.current;
      if (shallowEqualBillboard(prev, next)) {
        return;
      }
      const cloned = cloneBillboardState(next);
      billboardStateRef.current = cloned;
      setBillboardState(cloned);
    },
    [shallowEqualBillboard, cloneBillboardState],
  );

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
      <KeymapOverlay
        geometryMode={geometryMode}
        wavePositionEnabled={wavePositionEnabled}
        waveRotationEnabled={waveRotationEnabled}
        layoutMode={effectiveLayoutMode ?? 'matrix'}
        physicsActive={physicsActive}
      />
      <CanvasStage
        onSelectionChange={handleSelectionChange}
        onPresenterReady={handlePresenterReady}
        settings={settings}
        onDebug={handleDebugLine}
        onBillboardStateChange={handleBillboardStateChange}
        onAxisLabelsChange={setAxisLabels}
        onCameraSettingsChange={handleSettingsChange}
      />
      {settings.billboardMode === 'html' && billboardState && (
        <HtmlBillboard state={billboardState} settings={settings} onLayout={handleBillboardLayout} />
      )}
      {settings.axisLabelsEnabled && settings.axisLabelsMode === 'overlay' && axisLabels.length > 0 && (
        <AxisLabelsOverlay labels={axisLabels} />
      )}
      {contentStatus !== 'ready' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(5,6,11,0.92), rgba(12,16,28,0.88))',
            backdropFilter: 'blur(16px)',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              minWidth: '320px',
              maxWidth: '420px',
              padding: '32px',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 32px 64px rgba(0,0,0,0.35)',
              background: 'linear-gradient(160deg, rgba(18,20,32,0.85), rgba(32,36,56,0.75))',
              color: '#ffffff',
              textAlign: 'center',
            }}
          >
            {contentStatus === 'loading' && (
              <>
                <p style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>
                  Inhalte werden geladen …
                </p>
                <p style={{ fontSize: '14px', opacity: 0.75 }}>
                  Wir holen die aktuellen Beiträge &amp; Vorschaubilder vom Server.
                </p>
                <p style={{ fontSize: '12px', opacity: 0.55, marginTop: '16px' }}>{contentSummary}</p>
              </>
            )}
            {contentStatus === 'empty' && (
              <>
                <p style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>
                  Keine Inhalte verfügbar
                </p>
                <p style={{ fontSize: '14px', opacity: 0.75, marginBottom: '20px' }}>
                  Die API hat keine Beiträge zurückgeliefert. Bitte Datenquelle prüfen oder erneut versuchen.
                </p>
                <button
                  type="button"
                  onClick={handleRetryLoad}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '999px',
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.08)',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  Erneut laden
        </button>
                <p style={{ fontSize: '12px', opacity: 0.55, marginTop: '16px' }}>{contentSummary}</p>
              </>
            )}
            {contentStatus === 'error' && (
              <>
                <p style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>
                  Laden fehlgeschlagen
                </p>
                <p style={{ fontSize: '14px', opacity: 0.75, marginBottom: '20px' }}>
                  Abruf der Inhalte/Bilder fehlgeschlagen. Bitte Konsole prüfen und erneut versuchen.
                </p>
                <button
                  type="button"
                  onClick={handleRetryLoad}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '999px',
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.08)',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  Erneut laden
                </button>
                <p style={{ fontSize: '12px', opacity: 0.55, marginTop: '16px' }}>{contentSummary}</p>
              </>
            )}
          </div>
        </div>
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
        onCaptureRelativeOrbit={handleCaptureRelativeCamera}
        meta={panelMeta}
      />
      {settings.showDebugOverlay && (
        <DebugOverlay lines={debugLines} />
      )}
      </div>
  );
}
