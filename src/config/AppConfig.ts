import { Color3 } from '@babylonjs/core/Maths/math.color';

export type BackgroundType = 'solid' | 'gradient';
export type BillboardMode = '3d' | 'html';

export interface CubeWallConfig {
  maxGridSize: number;
  gridSize: number;
  cubeSize: number;
  cubeSpacing: number;
  selectedCubeLift: number;
  selectedCubePopOutDistance: number;
  selectedCubeRotation: number;
  waveAmplitudeY: number;
  waveFrequencyY: number;
  waveAmplitudeRot: number;
  waveFrequencyRot: number;
  waveSpeed: number;
  wavePhaseSpread: number;
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
  };
  tintColor: Color3;
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
  };
}

export const appConfig: CubeWallConfig = {
  maxGridSize: 35,
  gridSize: 25,
  cubeSize: 1.0,
  cubeSpacing: 0.15,
  selectedCubeLift: 1.0,
  selectedCubePopOutDistance: 0.5,
  selectedCubeRotation: Math.PI / 4,
  waveAmplitudeY: 0.15,
  waveFrequencyY: 0.3,
  waveAmplitudeRot: 0.08,
  waveFrequencyRot: 0.25,
  waveSpeed: 0.4,
  wavePhaseSpread: 0.05,
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
  slowAutorotateSpeed: 0.1,
  selectionCameraFollowEnabled: true,
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
  },
  tintColor: new Color3(0.3, 0.5, 1.0),
  ambientLightColorHex: '#ffffff',
  ambientLightIntensity: 0.35,
  directionalLightColorHex: '#ffffff',
  directionalLightIntensity: 0.8,
  directionalLightDirection: { x: 0.5, y: -1.0, z: 0.3 },
  fillLightEnabled: true,
  fillLightColorHex: '#8faaff',
  fillLightIntensity: 0.4,
  fillLightDirection: { x: 0, y: 1, z: 0 },
  background: {
    type: 'solid',
    solidColorHex: '#030308',
    gradientTopHex: '#102040',
    gradientBottomHex: '#050510',
  },
  billboard: {
    heightOffset: 1.8,
    distance: 2.2,
    angleDegrees: 45,
    mode: '3d',
    htmlContent: '<h2>Nebula Headline</h2><p>Cube <strong>{{gridX}}, {{gridZ}}</strong> strahlt mit Textur <strong>{{texture}}</strong> und Farbcode <span class="cw-html-billboard__pill">{{color}}</span>. Hier könnte deine Subheadline stehen – zum Beispiel eine kurze Zusammenfassung oder der Hook zur Story.</p><div class="cw-html-billboard__source"><span>Quelle: Deep Space Newsdesk</span><span>&bull;</span><span>AI Wire • 06 Nov 2025</span></div>',
  },
};
