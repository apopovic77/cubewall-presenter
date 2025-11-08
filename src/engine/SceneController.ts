import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Layer } from '@babylonjs/core/Layers/layer';
import '@babylonjs/core/Shaders/layer.vertex';
import '@babylonjs/core/Shaders/layer.fragment';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { DepthOfFieldEffectBlurLevel } from '@babylonjs/core/PostProcesses/depthOfFieldEffect';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import '@babylonjs/core/Shaders/kernelBlur.vertex';
import '@babylonjs/core/Shaders/kernelBlur.fragment';
import '@babylonjs/core/Shaders/depthOfField.fragment';
import '@babylonjs/core/Shaders/depthOfFieldMerge.fragment';
import '@babylonjs/core/Shaders/circleOfConfusion.fragment';
import '@babylonjs/core/Shaders/imageProcessing.fragment';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsEngine } from '@babylonjs/core/Physics/v2/physicsEngine';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import HavokPhysics from '@babylonjs/havok';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { appConfig, DOF_FOCUS_MIN, DOF_WORLD_TO_MM } from '../config/AppConfig';
import type { CubeWallConfig } from '../config/AppConfig';

export interface SceneControllerOptions {
  canvas: HTMLCanvasElement;
  config?: CubeWallConfig;
}

export class SceneController {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly config: CubeWallConfig;
  private readonly disposeHandlers: (() => void)[] = [];

  private ambientLight!: HemisphericLight;
  private directionalLight!: DirectionalLight;
  private fillLight: DirectionalLight | null = null;
  private gradientLayer: Layer | null = null;
  private renderingPipeline: DefaultRenderingPipeline | null = null;
  private physicsGround: Mesh | null = null;
  private physicsPlugin: HavokPlugin | null = null;
  private physicsReady = false;
  private havokInitPromise: Promise<HavokPlugin> | null = null;
  private physicsEngine: PhysicsEngine | null = null;
  private groundAggregate: PhysicsAggregate | null = null;
  private physicsStepObserver: Observer<Scene> | null = null;

  constructor({ canvas, config }: SceneControllerOptions) {
    this.config = config ?? appConfig;
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    this.engine.enableOfflineSupport = false;
    this.engine.setHardwareScalingLevel(1 / window.devicePixelRatio);

    this.scene = new Scene(this.engine);
    this.camera = this.createCamera(canvas);
    this.createLights();
    this.setupRenderingPipeline();
    this.updateLightingFromConfig();
    this.updateBackgroundFromConfig();
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.updateDepthOfFieldFromConfig();
    });

    const onResize = () => this.engine.resize();
    window.addEventListener('resize', onResize);
    this.disposeHandlers.push(() => window.removeEventListener('resize', onResize));
  }

  private createCamera(canvas: HTMLCanvasElement): ArcRotateCamera {
    const camera = new ArcRotateCamera(
      'presenterCamera',
      -Math.PI / 2,
      Math.PI / 2.5,
      this.config.camera.radius,
      Vector3.Zero(),
      this.scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = this.config.camera.minRadius;
    camera.upperRadiusLimit = this.config.camera.maxRadius;
    camera.wheelPrecision = this.config.camera.wheelPrecision;
    camera.panningSensibility = this.config.camera.panningSensibility;
    camera.setTarget(new Vector3(0, Math.max(1, this.config.gridSize / 10), 0));
    return camera;
  }

  private createLights(): void {
    this.ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    this.directionalLight = new DirectionalLight('directionalLight', new Vector3(0.5, -1, 0.3).normalize(), this.scene);
    this.fillLight = new DirectionalLight('fillLight', new Vector3(0, 1, 0), this.scene);
  }

  public getEngine(): Engine {
    return this.engine;
  }

  public getScene(): Scene {
    return this.scene;
  }

  public getCamera(): ArcRotateCamera {
    return this.camera;
  }

  public getRenderingPipeline(): DefaultRenderingPipeline | null {
    return this.renderingPipeline;
  }

  public updateCameraRadius(radius: number): void {
    this.camera.radius = Math.min(Math.max(radius, this.config.camera.minRadius), this.config.camera.maxRadius);
  }

  public updateLightingFromConfig(): void {
    if (this.ambientLight) {
      this.ambientLight.diffuse = Color3.FromHexString(this.config.ambientLightColorHex);
      this.ambientLight.specular = new Color3(0.1, 0.1, 0.1);
      this.ambientLight.intensity = this.config.ambientLightIntensity;
    }

    if (this.directionalLight) {
      this.directionalLight.diffuse = Color3.FromHexString(this.config.directionalLightColorHex);
      this.directionalLight.specular = Color3.FromHexString(this.config.directionalLightColorHex);
      this.directionalLight.intensity = this.config.directionalLightIntensity;
      this.directionalLight.direction = new Vector3(
        this.config.directionalLightDirection.x,
        this.config.directionalLightDirection.y,
        this.config.directionalLightDirection.z,
      ).normalize();
    }

    if (this.fillLight) {
      this.fillLight.setEnabled(this.config.fillLightEnabled);
      this.fillLight.diffuse = Color3.FromHexString(this.config.fillLightColorHex);
      this.fillLight.specular = Color3.FromHexString(this.config.fillLightColorHex);
      this.fillLight.intensity = this.config.fillLightIntensity;
      this.fillLight.direction = new Vector3(
        this.config.fillLightDirection.x,
        this.config.fillLightDirection.y,
        this.config.fillLightDirection.z,
      ).normalize();
    }
  }

  public updateBackgroundFromConfig(): void {
    if (this.config.background.type === 'solid') {
      const solidColor = Color3.FromHexString(this.config.background.solidColorHex);
      this.scene.clearColor = Color4.FromColor3(solidColor, 1);
      if (this.gradientLayer) {
        this.gradientLayer.texture?.dispose();
        this.gradientLayer.dispose();
        this.gradientLayer = null;
      }
      return;
    }

    if (!this.gradientLayer) {
      this.gradientLayer = new Layer('cwGradientLayer', null, this.scene, true);
      this.gradientLayer.isBackground = true;
    }

    if (this.gradientLayer.texture) {
      this.gradientLayer.texture.dispose();
    }
    const gradientTexture = this.createGradientTexture(
      this.config.background.gradientTopHex,
      this.config.background.gradientBottomHex,
    );
    gradientTexture.hasAlpha = true;
    this.gradientLayer.texture = gradientTexture;
    this.scene.clearColor = Color4.FromColor3(Color3.Black(), 1);
  }

  private createGradientTexture(topHex: string, bottomHex: string): Texture {
    const dynamicTexture = new DynamicTexture('cwGradientTexture', { width: 2, height: 256 }, this.scene, false);
    const canvasContext = dynamicTexture.getContext();
    if (canvasContext) {
      const gradient = canvasContext.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, topHex);
      gradient.addColorStop(1, bottomHex);
      canvasContext.fillStyle = gradient;
      canvasContext.fillRect(0, 0, 2, 256);
      dynamicTexture.update(false);
    }
    dynamicTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
    dynamicTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    dynamicTexture.hasAlpha = false;
    return dynamicTexture;
  }

  private setupRenderingPipeline(): void {
    if (this.renderingPipeline) {
      this.renderingPipeline.dispose();
    }
    this.renderingPipeline = new DefaultRenderingPipeline('cwDefaultPipeline', true, this.scene, [this.camera]);
    this.renderingPipeline.samples = 1;
  }

  public updateDepthOfFieldFromConfig(): void {
    if (!this.renderingPipeline) {
      this.setupRenderingPipeline();
    }
    if (!this.renderingPipeline) return;

    this.renderingPipeline.depthOfFieldEnabled = this.config.depthOfFieldEnabled;
    if (this.config.depthOfFieldEnabled) {
      this.scene.enableDepthRenderer(this.camera, false);
    } else {
      this.scene.disableDepthRenderer(this.camera);
    }
    const blurLevelMap: Record<string, DepthOfFieldEffectBlurLevel> = {
      low: DepthOfFieldEffectBlurLevel.Low,
      medium: DepthOfFieldEffectBlurLevel.Medium,
      high: DepthOfFieldEffectBlurLevel.High,
    };
    this.renderingPipeline.depthOfFieldBlurLevel = blurLevelMap[this.config.depthOfFieldBlurLevel] ?? DepthOfFieldEffectBlurLevel.Medium;

    if (this.renderingPipeline.depthOfField) {
      this.renderingPipeline.depthOfField.focusDistance = Math.max(DOF_FOCUS_MIN, this.config.depthOfFieldFocusDistance) * DOF_WORLD_TO_MM;
      this.renderingPipeline.depthOfField.fStop = this.config.depthOfFieldFStop;
      this.renderingPipeline.depthOfField.focalLength = this.config.depthOfFieldFocalLength;
    }
  }

  public setDepthOfFieldFocusDistance(distance: number, overrideFStop?: number): void {
    this.config.depthOfFieldFocusDistance = Math.max(DOF_FOCUS_MIN, distance);
    if (this.renderingPipeline?.depthOfField) {
      this.renderingPipeline.depthOfField.focusDistance = this.config.depthOfFieldFocusDistance * DOF_WORLD_TO_MM;
      const fStop = overrideFStop ?? this.config.depthOfFieldFStop;
      this.renderingPipeline.depthOfField.fStop = fStop;
    }
  }

  public dispose(): void {
    this.disposeHandlers.forEach((dispose) => dispose());
    if (this.gradientLayer) {
      this.gradientLayer.texture?.dispose();
      this.gradientLayer.dispose();
      this.gradientLayer = null;
    }
    this.groundAggregate?.dispose();
    this.groundAggregate = null;
    this.renderingPipeline?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  public async enablePhysicsAsync(): Promise<void> {
    if (this.physicsReady) return;
    if (!this.havokInitPromise) {
      this.havokInitPromise = HavokPhysics({
        locateFile: (path: string) => (path.endsWith('.wasm') ? '/havok/HavokPhysics.wasm' : path),
      }).then((havokInstance) => new HavokPlugin(true, havokInstance));
    }
    this.physicsPlugin = await this.havokInitPromise;
    if (!this.physicsReady) {
      this.physicsReady = true;
    }
    if (!this.physicsGround) {
      if (!this.physicsEngine) {
        this.physicsEngine = new PhysicsEngine(new Vector3(0, -9.81, 0), this.physicsPlugin!);
        this.physicsEngine.setSubTimeStep(1 / 120);
        if (!this.physicsStepObserver) {
          this.physicsStepObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (!this.physicsReady || !this.physicsEngine) return;
            this.physicsEngine._step(this.scene.getEngine().getDeltaTime() / 1000);
          });
        }
        (this.scene as unknown as { getPhysicsEngine?: () => PhysicsEngine | null }).getPhysicsEngine = () => this.physicsEngine;
        (this.scene as unknown as { _physicsEngine?: PhysicsEngine | null })._physicsEngine = this.physicsEngine;
      }
      this.physicsGround = MeshBuilder.CreateGround('physicsGround', { width: 400, height: 400 }, this.scene);
      this.physicsGround.position.y = this.config.physicsGroundHeight;
      this.physicsGround.isPickable = false;
      this.physicsGround.receiveShadows = true;
      this.physicsGround.material = null;
      this.groundAggregate = new PhysicsAggregate(
        this.physicsGround,
        PhysicsShapeType.BOX,
        { mass: 0, restitution: 0.2, friction: 0.6 },
        this.scene,
      );
    }
    this.physicsReady = true;
  }

  public isPhysicsReady(): boolean {
    return this.physicsReady;
  }

  public getPhysicsScene(): Scene {
    return this.scene;
  }

  public getPhysicsGroundHeight(): number {
    return this.config.physicsGroundHeight;
  }

  public disablePhysics(): void {
    if (this.physicsStepObserver) {
      this.scene.onBeforeRenderObservable.remove(this.physicsStepObserver);
      this.physicsStepObserver = null;
    }

    this.groundAggregate?.dispose();
    this.groundAggregate = null;
    this.physicsGround?.dispose();
    this.physicsGround = null;

    const physicsEngine = this.scene.getPhysicsEngine();
    physicsEngine?.dispose();
    this.physicsEngine = null;
    this.physicsReady = false;
    this.physicsPlugin = null;
    this.havokInitPromise = null;
  }
}
