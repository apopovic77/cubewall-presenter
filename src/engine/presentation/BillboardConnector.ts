import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { BillboardDisplayState, BillboardScreenMetrics } from '../CubeWallPresenter';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { CubeCell } from '../CubeField';
import type { CubeWallConfig } from '../../config/AppConfig';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { BILLBOARD_FADE_SECONDS } from '../../config/BillboardConstants';

const CONNECTOR_SHADER_NAME = 'htmlConnectorLine';
let connectorShaderRegistered = false;

function ensureConnectorShader(): void {
  if (connectorShaderRegistered) return;
  Effect.ShadersStore[`${CONNECTOR_SHADER_NAME}VertexShader`] = `
    precision highp float;

    attribute vec3 position;

    uniform vec3 start;
    uniform vec3 end;
    uniform float radius;
    uniform mat4 view;
    uniform mat4 projection;
    uniform vec3 cameraPosition;

    varying float vEdge;

    void main(void) {
      vec3 line = end - start;
      float lengthLine = max(length(line), 1e-6);
      vec3 forward = line / lengthLine;

      vec3 lineCenter = start + line * 0.5;
      vec3 cameraVector = normalize(cameraPosition - lineCenter);
      vec3 right = normalize(cross(cameraVector, forward));
      if (length(right) < 1e-4) {
        right = normalize(abs(forward.y) < 0.999 ? cross(vec3(0.0, 1.0, 0.0), forward) : cross(vec3(1.0, 0.0, 0.0), forward));
      }
      vec3 up = normalize(cross(forward, right));

      float offset = position.x;
      float along = position.y;
      vec3 worldPos = start + forward * along * lengthLine + right * offset * radius;

      gl_Position = projection * view * vec4(worldPos, 1.0);
      vEdge = abs(offset);
    }
  `;

  Effect.ShadersStore[`${CONNECTOR_SHADER_NAME}FragmentShader`] = `
    precision highp float;

    uniform vec3 color;
    uniform float feather;
    uniform float opacity;

    varying float vEdge;

    void main(void) {
      float edge = smoothstep(1.0 - feather, 1.0, vEdge);
      float alpha = (1.0 - edge) * opacity;
      if (alpha <= 0.004) {
        discard;
      }
      gl_FragColor = vec4(color, alpha);
    }
  `;
  connectorShaderRegistered = true;
}

/** What the connector needs from the presenter. */
export interface BillboardConnectorHost {
  getCamera(): ArcRotateCamera;
  /** Screen rectangle of the HTML billboard (null until it has been laid out). */
  readonly screenMetrics: BillboardScreenMetrics | null;
  /** Cube the billboard belongs to. */
  readonly currentCell: CubeCell | null;
}

/**
 * The line from the selected cube to the HTML billboard: a screen-space line
 * or a 3D tube (settings), faded in and out with the billboard.
 */
export class BillboardConnector {
  private readonly scene: Scene;
  private readonly config: CubeWallConfig;
  private readonly host: BillboardConnectorHost;
  private htmlConnectorMesh: Mesh | null = null;
  private htmlConnectorMaterial: ShaderMaterial | null = null;
  private htmlConnectorTube: Mesh | null = null;
  private htmlConnectorTubeMaterial: StandardMaterial | null = null;
  private readonly htmlConnectorColor = new Color3(0.3, 0.7, 1.0);
  private connectorCurrentAlpha = 0;
  private connectorTargetAlpha = 0;
  private readonly connectorFadeSpeed = BILLBOARD_FADE_SECONDS > 0 ? 1 / BILLBOARD_FADE_SECONDS : 1;

  constructor(scene: Scene, config: CubeWallConfig, host: BillboardConnectorHost) {
    this.scene = scene;
    this.config = config;
    this.host = host;
  }

  public hide(): void {
    this.setConnectorTargetAlpha(0);
  }

  private setConnectorTargetAlpha(target: number): void {
    const clamped = Math.min(Math.max(target, 0), 1);
    this.connectorTargetAlpha = clamped;
    if (clamped === 0 && this.connectorCurrentAlpha === 0) {
      this.applyConnectorAlpha();
    }
  }

  private applyConnectorAlpha(): void {
    const alpha = Math.min(Math.max(this.connectorCurrentAlpha, 0), 1);
    if (this.htmlConnectorMaterial) {
      this.htmlConnectorMaterial.setFloat('opacity', alpha);
    }
    if (this.htmlConnectorTubeMaterial) {
      this.htmlConnectorTubeMaterial.alpha = alpha;
      this.htmlConnectorTubeMaterial.diffuseColor.copyFrom(this.htmlConnectorColor);
      this.htmlConnectorTubeMaterial.emissiveColor.copyFrom(this.htmlConnectorColor);
      this.htmlConnectorTubeMaterial.emissiveColor.scaleInPlace(Math.max(alpha, 0) * 0.8);
    }
    const visible = alpha > 0.002;
    if (this.htmlConnectorMesh) {
      this.htmlConnectorMesh.isVisible = visible;
      this.htmlConnectorMesh.setEnabled(visible);
    }
    if (this.htmlConnectorTube) {
      this.htmlConnectorTube.visibility = alpha;
      this.htmlConnectorTube.isVisible = visible;
      this.htmlConnectorTube.setEnabled(visible);
    }
  }

  public updateFade(deltaTime: number): void {
    if (!this.htmlConnectorMesh && !this.htmlConnectorTube) {
      this.connectorCurrentAlpha = 0;
      this.connectorTargetAlpha = 0;
      return;
    }
    const diff = this.connectorTargetAlpha - this.connectorCurrentAlpha;
    if (Math.abs(diff) < 1e-4) {
      this.connectorCurrentAlpha = this.connectorTargetAlpha;
      this.applyConnectorAlpha();
      return;
    }
    const step = (this.connectorFadeSpeed * deltaTime);
    const delta = Math.sign(diff) * Math.min(Math.abs(diff), step);
    this.connectorCurrentAlpha = Math.min(Math.max(this.connectorCurrentAlpha + delta, 0), 1);
    this.applyConnectorAlpha();
  }

  public dispose(): void {
    this.htmlConnectorMesh?.dispose();
    this.htmlConnectorMesh = null;
    this.htmlConnectorMaterial?.dispose();
    this.htmlConnectorMaterial = null;
    this.htmlConnectorTube?.dispose();
    this.htmlConnectorTube = null;
    this.htmlConnectorTubeMaterial?.dispose();
    this.htmlConnectorTubeMaterial = null;
    this.connectorCurrentAlpha = 0;
    this.connectorTargetAlpha = 0;
  }

  private ensureHtmlConnectorMesh(): Mesh {
    if (this.htmlConnectorMesh && this.htmlConnectorMaterial) {
      return this.htmlConnectorMesh;
    }

    ensureConnectorShader();

    const mesh = new Mesh('htmlBillboardConnector', this.scene);
    const vertexData = new VertexData();
    vertexData.positions = [
      -1, 0, 0,
      -1, 1, 0,
      1, 0, 0,
      1, 1, 0,
    ];
    vertexData.indices = [0, 1, 2, 2, 1, 3];
    vertexData.applyToMesh(mesh, true);

    this.htmlConnectorMaterial = new ShaderMaterial(
      'htmlBillboardConnectorMaterial',
      this.scene,
      CONNECTOR_SHADER_NAME,
      {
        attributes: ['position'],
        uniforms: ['world', 'view', 'projection', 'start', 'end', 'radius', 'feather', 'color', 'cameraPosition', 'opacity'],
      },
    );
    this.htmlConnectorMaterial.backFaceCulling = false;
    this.htmlConnectorMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.htmlConnectorMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.htmlConnectorMaterial.disableDepthWrite = false;
    this.htmlConnectorMaterial.forceDepthWrite = false;
    this.htmlConnectorMaterial.needDepthPrePass = false;
    this.htmlConnectorMaterial.separateCullingPass = false;
    this.htmlConnectorMaterial.setColor3('color', this.htmlConnectorColor);
    this.htmlConnectorMaterial.setFloat('feather', 0.2);
    this.htmlConnectorMaterial.setFloat('opacity', this.connectorCurrentAlpha);

    mesh.material = this.htmlConnectorMaterial;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = this.host.currentCell?.mesh.renderingGroupId ?? 0;
    const visible = this.connectorCurrentAlpha > 0.001;
    mesh.isVisible = visible;
    mesh.setEnabled(visible);

    this.htmlConnectorMesh = mesh;
    return mesh;
  }

  private ensureHtmlConnectorTube(): Mesh {
    if (this.htmlConnectorTube && this.htmlConnectorTubeMaterial) {
      return this.htmlConnectorTube;
    }

    const path = [Vector3.Zero(), new Vector3(0, 0.1, 0)];
    const mesh = MeshBuilder.CreateTube(
      'htmlBillboardConnectorTube',
      {
        path,
        radius: 0.01,
        updatable: true,
        cap: Mesh.CAP_END,
      },
      this.scene,
    );
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    mesh.isVisible = false;

    this.htmlConnectorTubeMaterial = new StandardMaterial('htmlBillboardConnectorTubeMat', this.scene);
    this.htmlConnectorTubeMaterial.diffuseColor = this.htmlConnectorColor.clone();
    this.htmlConnectorTubeMaterial.emissiveColor = this.htmlConnectorColor.clone().scale(0.8);
    this.htmlConnectorTubeMaterial.specularColor = Color3.Black();
    this.htmlConnectorTubeMaterial.alpha = this.connectorCurrentAlpha;
    this.htmlConnectorTubeMaterial.backFaceCulling = false;
    this.htmlConnectorTubeMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.htmlConnectorTubeMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.htmlConnectorTubeMaterial.forceDepthWrite = false;
    this.htmlConnectorTubeMaterial.needDepthPrePass = false;
    this.htmlConnectorTubeMaterial.disableLighting = false;
    this.htmlConnectorTubeMaterial.twoSidedLighting = true;

    mesh.material = this.htmlConnectorTubeMaterial;

    this.htmlConnectorTube = mesh;
    return mesh;
  }

  private renderScreenSpaceConnector(
    startPoint: Vector3,
    endPoint: Vector3,
    radiusWorld: number,
    featherRatio: number,
    camera: Camera,
  ): void {
    if (this.htmlConnectorTube) {
      this.htmlConnectorTube.setEnabled(false);
      this.htmlConnectorTube.isVisible = false;
    }
    const mesh = this.ensureHtmlConnectorMesh();
    mesh.renderingGroupId = this.host.currentCell?.mesh.renderingGroupId ?? mesh.renderingGroupId;
    mesh.setEnabled(true);

    if (this.htmlConnectorMaterial) {
      this.htmlConnectorMaterial.setVector3('start', startPoint.clone());
      this.htmlConnectorMaterial.setVector3('end', endPoint.clone());
      this.htmlConnectorMaterial.setFloat('radius', Math.max(0.0005, radiusWorld));
      this.htmlConnectorMaterial.setFloat('feather', featherRatio);
      this.htmlConnectorMaterial.setColor3('color', this.htmlConnectorColor);
      this.htmlConnectorMaterial.setVector3('cameraPosition', camera.position.clone());
    }
    this.applyConnectorAlpha();
  }

  private renderTubeConnector(startPoint: Vector3, endPoint: Vector3, radiusWorld: number): void {
    if (this.htmlConnectorMesh) {
      this.htmlConnectorMesh.setEnabled(false);
      this.htmlConnectorMesh.isVisible = false;
    }

    const tube = this.ensureHtmlConnectorTube();
    tube.renderingGroupId = this.host.currentCell?.mesh.renderingGroupId ?? 0;

    const path = [startPoint.clone(), endPoint.clone()];
    const radius = Math.max(0.002, radiusWorld);

    MeshBuilder.CreateTube(
      tube.name,
      {
        path,
        radius,
        instance: tube,
      },
      this.scene,
    );

    if (this.htmlConnectorTubeMaterial) {
      this.htmlConnectorTubeMaterial.diffuseColor = this.htmlConnectorColor.clone();
      this.htmlConnectorTubeMaterial.emissiveColor = this.htmlConnectorColor.clone().scale(0.8);
    }

    tube.setEnabled(true);
    tube.isVisible = true;
    this.applyConnectorAlpha();
  }

  public update(
    state: BillboardDisplayState,
    cubeAnchor: Vector3,
    attachmentWorld: Vector3,
    canvasRect: DOMRect,
  ): void {
    if (this.config.billboard.mode !== 'html') {
      this.hide();
      return;
    }
    if (!state.isVisible) {
      this.hide();
      return;
    }

    if (this.config.billboard.connectorMode === 'htmlSvg') {
      this.hide();
      return;
    }

    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas || canvasRect.width === 0 || canvasRect.height === 0) {
      this.hide();
      return;
    }

    const renderWidth = this.scene.getEngine().getRenderWidth();
    const renderHeight = this.scene.getEngine().getRenderHeight();
    if (renderWidth === 0 || renderHeight === 0) {
      this.hide();
      return;
    }

    this.setConnectorTargetAlpha(1);

    const CLAMP_MARGIN = 24;
    const clampedX = Math.min(Math.max(state.screenX, CLAMP_MARGIN), state.viewportWidth - CLAMP_MARGIN);
    const clampedY = Math.min(Math.max(state.screenY, CLAMP_MARGIN), state.viewportHeight - CLAMP_MARGIN);

    const metrics = this.host.screenMetrics;
    const anchorScreenX = metrics?.centerX ?? clampedX;
    const anchorScreenY = metrics?.centerY ?? clampedY;

    const relativeX = (anchorScreenX - canvasRect.left) / canvasRect.width;
    const relativeY = (anchorScreenY - canvasRect.top) / canvasRect.height;
    if (!Number.isFinite(relativeX) || !Number.isFinite(relativeY)) {
      this.hide();
      return;
    }

    const normalizedX = Math.min(Math.max(relativeX, 0), 1);
    const normalizedY = Math.min(Math.max(relativeY, 0), 1);

    const pointerX = normalizedX * renderWidth;
    const pointerY = normalizedY * renderHeight;

    const camera = this.host.getCamera();
    const ray = this.scene.createPickingRay(pointerX, pointerY, Matrix.Identity(), camera, false);

    const forward = camera.target.subtract(camera.position);
    if (forward.lengthSquared() < 1e-6) {
      forward.set(0, 0, 1);
    }
    forward.normalize();

    const plane = Plane.FromPositionAndNormal(attachmentWorld, forward);
    const hitDistance = ray.intersectsPlane(plane);
    const endPoint = hitDistance !== null && Number.isFinite(hitDistance)
      ? ray.origin.add(ray.direction.scale(hitDistance))
      : attachmentWorld.clone();

    let startPoint = cubeAnchor.clone();
    const activeCell = this.host.currentCell;
    if (activeCell) {
      const cameraRay = Ray.CreateNewFromTo(camera.position, cubeAnchor);
      const pick = this.scene.pickWithRay(cameraRay, (mesh) => mesh === activeCell.mesh, false);
      if (pick?.hit && pick.pickedPoint) {
        startPoint = pick.pickedPoint.clone();
      } else {
        const boundingInfo = activeCell.mesh.getBoundingInfo();
        const corners = boundingInfo?.boundingBox?.vectorsWorld;
        if (corners && corners.length > 0) {
          const cameraPos = camera.position;
          let best = corners[0];
          let bestDist = Number.POSITIVE_INFINITY;
          corners.forEach((corner) => {
            const dist = Vector3.DistanceSquared(corner, cameraPos);
            if (Number.isFinite(dist) && dist < bestDist) {
              bestDist = dist;
              best = corner;
            }
          });
          startPoint = best.clone();
        }
      }
    }
    const direction = endPoint.subtract(startPoint);
    if (direction.lengthSquared() > 1e-6) {
      direction.normalize();
      endPoint.subtractInPlace(direction.scale(0.02 * this.config.cubeSize));
    }

    const connectorLength = Vector3.Distance(startPoint, endPoint);
    if (!Number.isFinite(connectorLength) || connectorLength <= 1e-4) {
      this.hide();
      return;
    }

    const midPoint = startPoint.add(endPoint).scale(0.5);
    const cameraForward = camera.getForwardRay().direction;
    let depth = Vector3.Dot(midPoint.subtract(camera.position), cameraForward);
    if (!Number.isFinite(depth) || depth <= 0) {
      depth = midPoint.subtract(camera.position).length();
    }

    const thicknessPx = Math.max(0.5, this.config.billboard.connectorThicknessPx);
    const featherPx = Math.max(0, this.config.billboard.connectorFeatherPx);
    const viewportHeight = Math.max(1, renderHeight);
    const worldHeight = 2 * depth * Math.tan(camera.fov / 2);
    const diameterWorld = (thicknessPx / viewportHeight) * worldHeight;
    const radiusWorld = Math.max(0.0005, diameterWorld * 0.5);
    const featherRatio = Math.min(0.49, featherPx / Math.max(thicknessPx, 0.0001));

    switch (this.config.billboard.connectorMode) {
      case 'tube3d': {
        const forwardDir = camera.getForwardRay().direction.clone();
        const tubeTarget = endPoint.clone().subtract(forwardDir.scale(0.02));
        this.renderTubeConnector(startPoint, tubeTarget, radiusWorld);
        break;
      }
      case 'screenSpace':
        this.renderScreenSpaceConnector(startPoint, endPoint, radiusWorld, featherRatio, camera);
        break;
      default:
        this.hide();
        break;
    }
  }
}
