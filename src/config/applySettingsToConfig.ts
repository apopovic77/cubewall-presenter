import type { CubeWallConfig, TextureUvLayout } from './AppConfig';
import type { PresenterSettings } from './PresenterSettings';

/**
 * The one place where presenter settings (what the user / settings store
 * holds) become engine configuration. Called by CubeWallPresenter.applySettings;
 * nothing else writes these config fields.
 */
export function applySettingsToConfig(settings: PresenterSettings, config: CubeWallConfig): void {
  // gridSize is applied by the presenter (it rebuilds the field when it changes).
  config.useFallbackImages = settings.useFallbackImages;
  config.textureUvLayout = settings.textureUvLayout;
  const { sidePattern, mirrorTopBottom } = mapUvLayout(settings.textureUvLayout);
  config.textureSidePattern = sidePattern;
  config.textureMirrorTopBottom = mirrorTopBottom;
  config.waveSpeed = settings.waveSpeed;
  config.wavePositionEnabled = settings.wavePositionEnabled;
  config.waveRotationEnabled = settings.waveRotationEnabled;
  config.waveAmplitudeY = settings.waveAmplitudeY;
  config.waveFrequencyY = settings.waveFrequencyY;
  config.wavePhaseSpread = settings.wavePhaseSpread;
  config.waveAmplitudeRot = settings.waveAmplitudeRot;
  config.waveFrequencyRot = settings.waveFrequencyRot;
  config.fieldAnimationSpeed = Math.max(0, settings.fieldAnimationSpeed);
  config.fieldGlobalScale = Math.max(0.1, settings.fieldGlobalScale);
  config.interactionRadius = settings.interactionRadius;
  config.interactionLift = settings.interactionLift;
  config.selectedCubeRotation = settings.selectedCubeRotation;
  config.selectedCubePopOutDistance = settings.selectedCubePopOutDistance;
  config.selectedCubeLift = settings.selectedCubeLift;
  config.selectedCubeNormalDirection = settings.selectedCubeNormalDirection;
  config.selectionSpinEnabled = settings.selectionSpinEnabled;
  config.camera.radius = settings.cameraRadius;
  config.camera.flyToRadiusFactor = settings.flyToRadiusFactor;
  config.camera.lerpSpeedFactor = settings.cameraLerpSpeed;
  config.camera.useCustomView = settings.useCustomCamera;
  config.camera.offset.x = settings.cameraOffsetX;
  config.camera.offset.y = settings.cameraOffsetY;
  config.camera.offset.z = settings.cameraOffsetZ;
  config.camera.lookAtOffset.x = settings.cameraLookAtOffsetX;
  config.camera.lookAtOffset.y = settings.cameraLookAtOffsetY;
  config.camera.lookAtOffset.z = settings.cameraLookAtOffsetZ;
  config.camera.animationSpeedFactor = settings.cameraAnimationSpeed;
  config.camera.orbitMode = settings.cameraOrbitMode;
  config.camera.followMode = settings.cameraFollowMode;
  config.camera.relativeOffset.x = settings.cameraRelativeOffsetX;
  config.camera.relativeOffset.y = settings.cameraRelativeOffsetY;
  config.camera.relativeOffset.z = settings.cameraRelativeOffsetZ;
  config.camera.relativeLookAtOffset.x = settings.cameraRelativeLookAtOffsetX;
  config.camera.relativeLookAtOffset.y = settings.cameraRelativeLookAtOffsetY;
  config.camera.relativeLookAtOffset.z = settings.cameraRelativeLookAtOffsetZ;
  config.camera.autoOrbitEnabled = settings.cameraAutoOrbitEnabled;
  config.camera.autoOrbitSpeed = settings.cameraAutoOrbitSpeed;
  config.physicsSelectedRotationMode = settings.physicsSelectedRotationMode;
  config.physicsSelectedRotationSpeed = settings.physicsSelectedRotationSpeed;
  config.physicsLiftSpeed = settings.physicsLiftSpeed;
  config.geometryMode = settings.geometryMode;
  config.tileDepth = settings.tileDepth;
  config.tileAspectMode = settings.tileAspectMode;
  config.baseOrientation = settings.baseOrientation;
  config.tiles.captionsEnabled = settings.tileCaptionsEnabled;
  config.tiles.text.tileWidth = Math.max(0.2, settings.textTileWidth);
  config.tiles.text.verticalGap = Math.max(0, settings.textTileVerticalGap);
  config.tiles.text.glassAlpha = Math.min(Math.max(settings.textTileGlassAlpha, 0), 1);
  config.masonry.columnCount = Math.max(1, Math.round(settings.masonryColumnCount));
  config.masonry.columnSpacing = Math.max(0, settings.masonryColumnSpacing);
  config.masonry.rowSpacing = Math.max(0, settings.masonryRowSpacing);
  config.ambientLightIntensity = settings.ambientLightIntensity;
  config.ambientLightColorHex = settings.ambientLightColorHex;
  config.directionalLightIntensity = settings.directionalLightIntensity;
  config.directionalLightColorHex = settings.directionalLightColorHex;
  config.directionalLightDirection.x = settings.directionalLightDirectionX;
  config.directionalLightDirection.y = settings.directionalLightDirectionY;
  config.directionalLightDirection.z = settings.directionalLightDirectionZ;
  config.fillLightEnabled = settings.fillLightEnabled;
  config.fillLightIntensity = settings.fillLightIntensity;
  config.fillLightColorHex = settings.fillLightColorHex;
  config.fillLightDirection.x = settings.fillLightDirectionX;
  config.fillLightDirection.y = settings.fillLightDirectionY;
  config.fillLightDirection.z = settings.fillLightDirectionZ;
  config.background.type = settings.backgroundType;
  config.background.solidColorHex = settings.backgroundSolidHex;
  config.background.gradientTopHex = settings.backgroundGradientTopHex;
  config.background.gradientBottomHex = settings.backgroundGradientBottomHex;
  config.billboard.heightOffset = settings.billboardHeightOffset;
  config.billboard.distance = settings.billboardDistance;
  config.billboard.angleDegrees = settings.billboardAngleDegrees;
  config.billboard.connectorMode = settings.billboardConnectorMode;
  config.billboard.connectorThicknessPx = settings.billboardConnectorThicknessPx;
  config.billboard.connectorFeatherPx = settings.billboardConnectorFeatherPx;
  config.slowAutorotateEnabled = settings.slowAutorotateEnabled;
  config.slowAutorotateSpeed = settings.slowAutorotateSpeed;
  config.selectionCameraFollowEnabled = settings.selectionCameraFollowEnabled;
  config.depthOfFieldEnabled = settings.depthOfFieldEnabled;
  config.depthOfFieldFocusDistance = settings.depthOfFieldFocusDistance;
  config.depthOfFieldFStop = settings.depthOfFieldFStop;
  config.depthOfFieldFocalLength = settings.depthOfFieldFocalLength;
  config.depthOfFieldBlurLevel = settings.depthOfFieldBlurLevel;
  config.depthOfFieldAutoFocusEnabled = settings.depthOfFieldAutoFocusEnabled;
  config.depthOfFieldAutoFocusOffset = settings.depthOfFieldAutoFocusOffset;
  config.depthOfFieldAutoFocusSharpness = settings.depthOfFieldAutoFocusSharpness;
  if (settings.depthOfFieldAutoFocusEnabled) {
    config.depthOfFieldFocusDistance = settings.depthOfFieldFocusDistance;
    config.depthOfFieldFStop = settings.depthOfFieldFStop;
  }
  config.billboard.mode = settings.billboardMode;
  config.billboard.htmlContent = settings.billboardHtmlContent;
  config.axisLabels.enabled = settings.axisLabelsEnabled;
  config.axisLabels.mode = settings.axisLabelsMode;
  config.axisLabels.startDateIso = settings.axisLabelsStartDate;
  config.axisLabels.stepDays = Math.max(1, settings.axisLabelsStepDays);
  config.axisLabels.template = settings.axisLabelsTemplate;
  config.axisLabels.offset.x = settings.axisLabelsOffsetX;
  config.axisLabels.offset.y = settings.axisLabelsOffsetY;
  config.axisLabels.offset.z = settings.axisLabelsOffsetZ;
}

/** Texture UV layout setting → side pattern and top/bottom mirroring. */
export function mapUvLayout(layout: TextureUvLayout): { sidePattern: 'uniform' | 'alternating'; mirrorTopBottom: boolean } {
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
