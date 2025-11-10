import { appConfig } from './AppConfig';
import type {
  AxisLabelsMode,
  BackgroundType,
  BillboardMode,
  BillboardConnectorMode,
  DepthOfFieldBlurLevel,
  TextureUvLayout,
} from './AppConfig';

export interface PresenterSettings {
  gridSize: number;
  useFallbackImages: boolean;
  useDynamicFallbacks: boolean;
  textureUvLayout: TextureUvLayout;
  waveSpeed: number;
  waveAmplitudeY: number;
  waveAmplitudeRot: number;
  fieldAnimationSpeed: number;
  fieldGlobalScale: number;
  enableHoverInteraction: boolean;
  autoSelectEnabled: boolean;
  autoSelectInterval: number;
  interactionRadius: number;
  interactionLift: number;
  selectedCubeRotation: number;
  selectedCubePopOutDistance: number;
  selectedCubeLift: number;
  selectedCubeNormalDirection: 1 | -1;
  showSelectionOverlay: boolean;
  showDebugOverlay: boolean;
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
  cameraRadius: number;
  flyToRadiusFactor: number;
  cameraLerpSpeed: number;
  useCustomCamera: boolean;
  cameraOffsetX: number;
  cameraOffsetY: number;
  cameraOffsetZ: number;
  cameraLookAtOffsetX: number;
  cameraLookAtOffsetY: number;
  cameraLookAtOffsetZ: number;
  cameraAnimationSpeed: number;
  ambientLightIntensity: number;
  ambientLightColorHex: string;
  directionalLightIntensity: number;
  directionalLightColorHex: string;
  directionalLightDirectionX: number;
  directionalLightDirectionY: number;
  directionalLightDirectionZ: number;
  fillLightEnabled: boolean;
  fillLightIntensity: number;
  fillLightColorHex: string;
  fillLightDirectionX: number;
  fillLightDirectionY: number;
  fillLightDirectionZ: number;
  backgroundType: BackgroundType;
  backgroundSolidHex: string;
  backgroundGradientTopHex: string;
  backgroundGradientBottomHex: string;
  billboardHeightOffset: number;
  billboardDistance: number;
  billboardAngleDegrees: number;
  billboardMode: BillboardMode;
  billboardHtmlContent: string;
  billboardConnectorMode: BillboardConnectorMode;
  billboardConnectorThicknessPx: number;
  billboardConnectorFeatherPx: number;
  axisLabelsEnabled: boolean;
  axisLabelsStartDate: string;
  axisLabelsStepDays: number;
  axisLabelsTemplate: string;
  axisLabelsOffsetX: number;
  axisLabelsOffsetY: number;
  axisLabelsOffsetZ: number;
  axisLabelsMode: AxisLabelsMode;
}

export const defaultPresenterSettings: PresenterSettings = {
  gridSize: appConfig.gridSize,
  useFallbackImages: appConfig.useFallbackImages,
  useDynamicFallbacks: appConfig.useFallbackImages,
  textureUvLayout: appConfig.textureUvLayout,
  waveSpeed: appConfig.waveSpeed,
  waveAmplitudeY: appConfig.waveAmplitudeY,
  waveAmplitudeRot: appConfig.waveAmplitudeRot,
  fieldAnimationSpeed: appConfig.fieldAnimationSpeed,
  fieldGlobalScale: appConfig.fieldGlobalScale,
  enableHoverInteraction: true,
  autoSelectEnabled: true,
  autoSelectInterval: 6,
  interactionRadius: appConfig.interactionRadius,
  interactionLift: appConfig.interactionLift,
  selectedCubeRotation: appConfig.selectedCubeRotation,
  selectedCubePopOutDistance: appConfig.selectedCubePopOutDistance,
  selectedCubeLift: appConfig.selectedCubeLift,
  selectedCubeNormalDirection: appConfig.selectedCubeNormalDirection,
  showSelectionOverlay: false,
  showDebugOverlay: false,
  slowAutorotateEnabled: false,
  slowAutorotateSpeed: 0.1,
  selectionCameraFollowEnabled: true,
  depthOfFieldEnabled: appConfig.depthOfFieldEnabled,
  depthOfFieldFocusDistance: appConfig.depthOfFieldFocusDistance,
  depthOfFieldFStop: appConfig.depthOfFieldFStop,
  depthOfFieldFocalLength: appConfig.depthOfFieldFocalLength ?? 50,
  depthOfFieldBlurLevel: appConfig.depthOfFieldBlurLevel,
  depthOfFieldAutoFocusEnabled: appConfig.depthOfFieldAutoFocusEnabled,
  depthOfFieldAutoFocusOffset: appConfig.depthOfFieldAutoFocusOffset,
  depthOfFieldAutoFocusSharpness: appConfig.depthOfFieldAutoFocusSharpness ?? 1,
  cameraRadius: appConfig.camera.radius,
  flyToRadiusFactor: appConfig.camera.flyToRadiusFactor,
  cameraLerpSpeed: appConfig.camera.lerpSpeedFactor,
  useCustomCamera: appConfig.camera.useCustomView,
  cameraOffsetX: appConfig.camera.offset.x,
  cameraOffsetY: appConfig.camera.offset.y,
  cameraOffsetZ: appConfig.camera.offset.z,
  cameraLookAtOffsetX: appConfig.camera.lookAtOffset.x,
  cameraLookAtOffsetY: appConfig.camera.lookAtOffset.y,
  cameraLookAtOffsetZ: appConfig.camera.lookAtOffset.z,
  cameraAnimationSpeed: appConfig.camera.animationSpeedFactor,
  ambientLightIntensity: appConfig.ambientLightIntensity,
  ambientLightColorHex: appConfig.ambientLightColorHex,
  directionalLightIntensity: appConfig.directionalLightIntensity,
  directionalLightColorHex: appConfig.directionalLightColorHex,
  directionalLightDirectionX: appConfig.directionalLightDirection.x,
  directionalLightDirectionY: appConfig.directionalLightDirection.y,
  directionalLightDirectionZ: appConfig.directionalLightDirection.z,
  fillLightEnabled: appConfig.fillLightEnabled,
  fillLightIntensity: appConfig.fillLightIntensity,
  fillLightColorHex: appConfig.fillLightColorHex,
  fillLightDirectionX: appConfig.fillLightDirection.x,
  fillLightDirectionY: appConfig.fillLightDirection.y,
  fillLightDirectionZ: appConfig.fillLightDirection.z,
  backgroundType: appConfig.background.type,
  backgroundSolidHex: appConfig.background.solidColorHex,
  backgroundGradientTopHex: appConfig.background.gradientTopHex,
  backgroundGradientBottomHex: appConfig.background.gradientBottomHex,
  billboardHeightOffset: appConfig.billboard.heightOffset,
  billboardDistance: appConfig.billboard.distance,
  billboardAngleDegrees: appConfig.billboard.angleDegrees,
  billboardMode: appConfig.billboard.mode,
  billboardHtmlContent: appConfig.billboard.htmlContent,
  billboardConnectorMode: appConfig.billboard.connectorMode,
  billboardConnectorThicknessPx: appConfig.billboard.connectorThicknessPx,
  billboardConnectorFeatherPx: appConfig.billboard.connectorFeatherPx,
  axisLabelsEnabled: appConfig.axisLabels.enabled,
  axisLabelsStartDate: appConfig.axisLabels.startDateIso,
  axisLabelsStepDays: appConfig.axisLabels.stepDays,
  axisLabelsTemplate: appConfig.axisLabels.template,
  axisLabelsOffsetX: appConfig.axisLabels.offset.x,
  axisLabelsOffsetY: appConfig.axisLabels.offset.y,
  axisLabelsOffsetZ: appConfig.axisLabels.offset.z,
  axisLabelsMode: appConfig.axisLabels.mode,
};
