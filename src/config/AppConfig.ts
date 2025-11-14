import { Color3 } from '@babylonjs/core/Maths/math.color';

export type BackgroundType = 'solid' | 'gradient';
export type DepthOfFieldBlurLevel = 'low' | 'medium' | 'high';
export const DOF_FOCUS_MIN = 5;
export const DOF_WORLD_TO_MM = 1000;
export type BillboardMode = '3d' | 'html';
export type BillboardConnectorMode = 'htmlSvg' | 'tube3d' | 'screenSpace';
export type AxisLabelsMode = 'overlay' | '3d';
export type AxisLabelAxis = 'rows' | 'columns';
export type TextureSidePattern = 'uniform' | 'alternating';
export type TextureUvLayout = 'standard' | 'mirrorTopAndAlternatingSides' | 'uniformSides';
export type CameraOrbitMode = 'flyTo' | 'relativeOffset';
export type CameraFollowMode = 'focusOnce' | 'continuous';
export type GeometryMode = 'cube' | 'tile';
export type TileAspectMode = 'image' | 'square';
export type PhysicsSelectedRotationMode = 'static' | 'animated';
export type CubeLayoutMode = 'matrix' | 'axis' | 'masonry';
export type CubeLayoutAxis = AxisLabelAxis;
export type CubeLayoutOrder = 'asc' | 'desc';
export type CubeTintMode = 'gradient' | 'solid';
export type BaseOrientationMode = 'upright' | 'frontUp';

export interface TileImageConfig {
  baseWidth: number;
  thickness: number;
  defaultAspect: number;
}

export interface TileTextConfig {
  tileWidth: number;
  thickness: number;
  maxRenderWidth: number;
  padding: number;
  verticalGap: number;
  glassTintHex: string;
  glassAlpha: number;
}

export interface TileSystemConfig {
  captionsEnabled: boolean;
  image: TileImageConfig;
  text: TileTextConfig;
}

export interface MasonryConfig {
  columnCount: number;
  columnSpacing: number;
  rowSpacing: number;
}

export interface CubeTintConfig {
  mode: CubeTintMode;
  solidColorHex: string;
  gradientSaturation: number;
  gradientValue: number;
  diffuseScale: number;
}

export interface CubeLayoutConfig {
  mode: CubeLayoutMode;
  axis: CubeLayoutAxis;
  axisKey: string;
  sortOrder: CubeLayoutOrder;
  axisOrder: CubeLayoutOrder;
}

export interface CubeWallConfig {
  maxGridSize: number;
  gridSize: number;
  cubeSize: number;
  cubeSpacing: number;
  physicsGroundHeight: number;
  selectedCubeLift: number;
  selectedCubeNormalDirection: 1 | -1;
  selectedCubePopOutDistance: number;
  selectedCubeRotation: number;
  textureUvLayout: TextureUvLayout;
  textureSidePattern: TextureSidePattern;
  textureMirrorTopBottom: boolean;
  waveAmplitudeY: number;
  waveFrequencyY: number;
  waveAmplitudeRot: number;
  waveFrequencyRot: number;
  waveSpeed: number;
  wavePositionEnabled: boolean;
  waveRotationEnabled: boolean;
  selectionSpinEnabled: boolean;
  wavePhaseSpread: number;
  fieldAnimationSpeed: number;
  fieldGlobalScale: number;
  individualXRotSpeed: number;
  interactionRadius: number;
  interactionLift: number;
  interactionRotateAmount: number;
  interactionLerpSpeed: number;
  useFallbackImages: boolean;
  picsumErrorThreshold: number;
  fallbackTextureUrls: string[];
  fallbackTextureUrlsSafe: string[];
  slowAutorotateEnabled: boolean;
  slowAutorotateSpeed: number;
  selectionCameraFollowEnabled: boolean;
  depthOfFieldEnabled: boolean;
  depthOfFieldFocusDistance: number;
  depthOfFieldFStop: number;
  depthOfFieldFocalLength: number;
  depthOfFieldBlurLevel: DepthOfFieldBlurLevel;
  depthOfFieldAutoFocusEnabled: boolean;
  depthOfFieldAutoFocusOffset: number;
  depthOfFieldAutoFocusSharpness: number;
  camera: {
    radius: number;
    minRadius: number;
    maxRadius: number;
    wheelPrecision: number;
    panningSensibility: number;
    lerpSpeedFactor: number;
    flyToRadiusFactor: number;
    useCustomView: boolean;
    offset: { x: number; y: number; z: number };
    lookAtOffset: { x: number; y: number; z: number };
    animationSpeedFactor: number;
    orbitMode: CameraOrbitMode;
    followMode: CameraFollowMode;
    relativeOffset: { x: number; y: number; z: number };
    relativeLookAtOffset: { x: number; y: number; z: number };
    autoOrbitEnabled: boolean;
    autoOrbitSpeed: number;
  };
  tintColor: Color3;
  cubeTint: CubeTintConfig;
  ambientLightColorHex: string;
  ambientLightIntensity: number;
  directionalLightColorHex: string;
  directionalLightIntensity: number;
  directionalLightDirection: { x: number; y: number; z: number };
  fillLightEnabled: boolean;
  fillLightColorHex: string;
  fillLightIntensity: number;
  fillLightDirection: { x: number; y: number; z: number };
  background: {
    type: BackgroundType;
    solidColorHex: string;
    gradientTopHex: string;
    gradientBottomHex: string;
  };
  billboard: {
    heightOffset: number;
    distance: number;
    angleDegrees: number;
    mode: BillboardMode;
    htmlContent: string;
    connectorMode: BillboardConnectorMode;
    connectorThicknessPx: number;
    connectorFeatherPx: number;
  };
  axisLabels: {
    enabled: boolean;
    mode: AxisLabelsMode;
    startDateIso: string;
    stepDays: number;
    template: string;
    offset: { x: number; y: number; z: number };
    axes?: AxisLabelAxis[];
  };
  fieldSystemV2Enabled?: boolean;
  fieldLayoutType?: 'grid' | 'spiral';
  gridPlane: {
    origin: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
  };
  layout: CubeLayoutConfig;
  physicsSelectedRotationMode: PhysicsSelectedRotationMode;
  physicsSelectedRotationSpeed: number;
  physicsLiftSpeed: number;
  geometryMode: GeometryMode;
  tileDepth: number;
  tileAspectMode: TileAspectMode;
  baseOrientation: BaseOrientationMode;
  tiles: TileSystemConfig;
  masonry: MasonryConfig;
}

export const appConfig: CubeWallConfig = {
  maxGridSize: 35,
  gridSize: 25,
  cubeSize: 1.0,
  cubeSpacing: 0.15,
  physicsGroundHeight: -0.5,
  selectedCubeLift: 1.6,
  selectedCubePopOutDistance: 0.5,
  selectedCubeNormalDirection: 1,
  selectedCubeRotation: Math.PI / 2,
  textureUvLayout: 'standard',
  textureSidePattern: 'uniform',
  textureMirrorTopBottom: false,
  waveAmplitudeY: 0.18,
  waveFrequencyY: 0.35,
  waveAmplitudeRot: 0.12,
  waveFrequencyRot: 0.55,
  waveSpeed: 0.45,
  wavePositionEnabled: true,
  waveRotationEnabled: true,
  selectionSpinEnabled: true,
  wavePhaseSpread: 0.12,
  fieldAnimationSpeed: 1,
  fieldGlobalScale: 1,
  individualXRotSpeed: 0.2,
  interactionRadius: 4,
  interactionLift: 1.2,
  interactionRotateAmount: Math.PI / 5,
  interactionLerpSpeed: 8,
  useFallbackImages: false,
  picsumErrorThreshold: 8,
  fallbackTextureUrls: [
    'https://assets.babylonjs.com/textures/crate.png',
    'https://assets.babylonjs.com/textures/grass.jpg',
    'https://assets.babylonjs.com/textures/floor.png',
    'https://assets.babylonjs.com/textures/wood.jpg',
  ],
  fallbackTextureUrlsSafe: [
    'https://assets.babylonjs.com/textures/crate.png',
    'https://assets.babylonjs.com/textures/floor.png',
  ],
  slowAutorotateEnabled: false,
  slowAutorotateSpeed: 0.2,
  selectionCameraFollowEnabled: true,
  depthOfFieldEnabled: false,
  depthOfFieldFocusDistance: 150,
  depthOfFieldFStop: 2.8,
  depthOfFieldFocalLength: 60,
  depthOfFieldBlurLevel: 'medium',
  depthOfFieldAutoFocusEnabled: true,
  depthOfFieldAutoFocusOffset: 0,
  depthOfFieldAutoFocusSharpness: 1,
  camera: {
    radius: 75,
    minRadius: 2,
    maxRadius: 300,
    wheelPrecision: 10,
    panningSensibility: 1500,
    lerpSpeedFactor: 0.07,
    flyToRadiusFactor: 4,
    useCustomView: false,
    offset: { x: 0, y: 1.5, z: -3 },
    lookAtOffset: { x: 0, y: 0.5, z: 0 },
    animationSpeedFactor: 1.0,
    orbitMode: 'flyTo',
    followMode: 'focusOnce',
    relativeOffset: { x: 0, y: 2.5, z: 6 },
    relativeLookAtOffset: { x: 0, y: 0, z: 0 },
    autoOrbitEnabled: false,
    autoOrbitSpeed: 0.25,
  },
  tintColor: new Color3(0.3, 0.5, 1.0),
  cubeTint: {
    mode: 'gradient',
    solidColorHex: '#d8d8ff',
    gradientSaturation: 0.45,
    gradientValue: 1,
    diffuseScale: 0.4,
  },
  ambientLightColorHex: '#ffffff',
  ambientLightIntensity: 0.35,
  directionalLightColorHex: '#ffffff',
  directionalLightIntensity: 1.2,
  directionalLightDirection: { x: 0.5, y: -1.0, z: 0.3 },
  fillLightEnabled: true,
  fillLightColorHex: '#8faaff',
  fillLightIntensity: 0.4,
  fillLightDirection: { x: 0, y: 1, z: 0 },
  background: {
    type: 'gradient',
    solidColorHex: '#030308',
    gradientTopHex: '#648ae3',
    gradientBottomHex: '#b3b3ea',
  },
  billboard: {
    heightOffset: 1.8,
    distance: 2.2,
    angleDegrees: 45,
    mode: 'html',
    htmlContent:
      '<div class="cw-html-billboard__meta"><span>{{source}}</span><span>{{publishedAt}}</span><span>{{category}}</span></div><h2>{{title}}</h2><p>{{summary}}</p><a class="cw-html-billboard__link" href="{{url}}" target="_blank" rel="noreferrer">Zum Artikel</a>',
    connectorMode: 'screenSpace',
    connectorThicknessPx: 5,
    connectorFeatherPx: 1.2,
  },
  axisLabels: {
    enabled: true,
    mode: 'overlay',
    startDateIso: '2025-10-01',
    stepDays: 1,
    template: '{{date}}',
    offset: { x: -1.0, y: 0.25, z: 0 },
    axes: ['rows'],
  },
  fieldSystemV2Enabled: false,
  fieldLayoutType: 'grid',
  gridPlane: {
    origin: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
  },
  layout: {
    mode: 'matrix',
    axis: 'rows',
    axisKey: 'publishedDay',
    sortOrder: 'desc',
    axisOrder: 'desc',
  },
  physicsSelectedRotationMode: 'static',
  physicsSelectedRotationSpeed: Math.PI,
  physicsLiftSpeed: 1.8,
  geometryMode: 'cube',
  tileDepth: 0.12,
  tileAspectMode: 'image',
  baseOrientation: 'upright',
  tiles: {
    captionsEnabled: false,
    image: {
      baseWidth: 1.4,
      thickness: 0.12,
      defaultAspect: 1.6,
    },
    text: {
      tileWidth: 1.4,
      thickness: 0.08,
      maxRenderWidth: 480,
      padding: 24,
      verticalGap: 0.12,
      glassTintHex: '#9bd5ff',
      glassAlpha: 0.78,
    },
  },
  masonry: {
    columnCount: 4,
    columnSpacing: 0.35,
    rowSpacing: 0.4,
  },
};
