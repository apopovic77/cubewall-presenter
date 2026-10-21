import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PhysicsCompanion } from '../physics/FieldPhysics';
import type { TileDescriptor } from './TileTypes';

/** An image tile and the caption tile under it: one domino. */
export interface TileGroupLink {
  leader: number;
  follower: number;
}

/**
 * Pairs of image tile (leader) and glass caption tile (follower) that behave as
 * one object: the layout places the pair, the caption hangs at a fixed offset
 * below the image in the image's own frame (so it turns with it), and physics
 * simulates the pair as one body.
 *
 * Offsets are along the tiles' local +Y (their height axis; image textures
 * are applied with invertY, so +Y is "down" in the picture), unscaled, in root
 * units: the caption sits under the image as the picture reads.
 */
export class TileGroups {
  public links: TileGroupLink[] = [];
  private leaderOfIndex = new Int32Array(0);
  private followerOfIndex = new Int32Array(0);
  private descriptors: readonly TileDescriptor[] = [];
  private readonly gap: () => number;
  private readonly rotationScratch = new Quaternion();
  private readonly centreScratch = new Vector3();
  private readonly leaderShiftScratch = new Vector3();
  private readonly followerShiftScratch = new Vector3();

  /** `gap`: space between image and caption (config, read on every use). */
  constructor(gap: () => number) {
    this.gap = gap;
  }

  public rebuild(descriptors: readonly TileDescriptor[]): void {
    this.descriptors = descriptors;
    this.links = [];
    this.leaderOfIndex = new Int32Array(descriptors.length).fill(-1);
    this.followerOfIndex = new Int32Array(descriptors.length).fill(-1);
    const leaders = new Map<string, number>();
    descriptors.forEach((descriptor, index) => {
      const stacking = descriptor.stacking;
      if (!stacking) return;
      if (stacking.role === 'leader') {
        leaders.set(stacking.groupId, index);
        return;
      }
      const leader = leaders.get(stacking.groupId);
      if (leader === undefined || this.followerOfIndex[leader] >= 0) return;
      this.links.push({ leader, follower: index });
      this.leaderOfIndex[index] = leader;
      this.followerOfIndex[leader] = index;
    });
  }

  public clear(): void {
    this.rebuild([]);
  }

  /** Leader index of a caption tile, or -1. */
  public leaderOf(index: number): number {
    return index < this.leaderOfIndex.length ? this.leaderOfIndex[index] : -1;
  }

  /** Caption tile index of an image tile, or -1. */
  public followerOf(index: number): number {
    return index < this.followerOfIndex.length ? this.followerOfIndex[index] : -1;
  }

  /** Extent of the whole group along the tiles' height axis. */
  public groupHeight(link: TileGroupLink): number {
    return this.height(link.leader) + this.gap() + this.height(link.follower);
  }

  /** Centres of leader and follower relative to the group centre, local frame. */
  public shiftsToRef(link: TileGroupLink, leaderOut: Vector3, followerOut: Vector3): void {
    const leaderHeight = this.height(link.leader);
    const followerHeight = this.height(link.follower);
    const gap = this.gap();
    leaderOut.set(0, -(gap + followerHeight) / 2, 0);
    followerOut.set(0, (leaderHeight + gap) / 2, 0);
  }

  /** Follower centre relative to the leader centre, in the leader's local frame. */
  public followerOffsetToRef(link: TileGroupLink, out: Vector3): Vector3 {
    return out.set(0, this.height(link.leader) / 2 + this.gap() + this.height(link.follower) / 2, 0);
  }

  /**
   * Layout pass: the sampled position of a leader is its group's centre; the
   * leader and its caption are moved to their places around it (in the
   * leader's base orientation). Caption slots of the layout are ignored.
   */
  public placeInLayout(positions: Vector3[], baseRotationOf: (index: number) => Vector3 | undefined): void {
    const centre = this.centreScratch;
    const leaderShift = this.leaderShiftScratch;
    const followerShift = this.followerShiftScratch;
    for (const link of this.links) {
      if (link.leader >= positions.length || link.follower >= positions.length) continue;
      const rotation = baseRotationOf(link.leader);
      if (!rotation) continue;
      centre.copyFrom(positions[link.leader]);
      this.shiftsToRef(link, leaderShift, followerShift);
      this.placeToRef(centre, rotation, leaderShift, positions[link.leader]);
      this.placeToRef(centre, rotation, followerShift, positions[link.follower]);
    }
  }

  /** Physics: the caption of image tile `index` as a second box of its body, or null. */
  public companionOf(index: number, cells: readonly { mesh: Mesh; basePosition: Vector3 }[]): PhysicsCompanion | null {
    const follower = this.followerOf(index);
    const caption = follower >= 0 ? cells[follower] : undefined;
    if (!caption) return null;
    return {
      mesh: caption.mesh,
      basePosition: caption.basePosition,
      offset: this.followerOffsetToRef({ leader: index, follower }, new Vector3()),
    };
  }

  /** `out` = position + rotation(euler) · local offset. */
  public placeToRef(position: Vector3, rotation: Vector3, localOffset: Vector3, out: Vector3): Vector3 {
    Quaternion.FromEulerAnglesToRef(rotation.x, rotation.y, rotation.z, this.rotationScratch);
    localOffset.rotateByQuaternionToRef(this.rotationScratch, out);
    return out.addInPlace(position);
  }

  private height(index: number): number {
    return this.descriptors[index]?.footprint.height ?? 0;
  }
}
