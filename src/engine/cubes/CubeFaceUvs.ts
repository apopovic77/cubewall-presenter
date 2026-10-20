import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import type { TextureSidePattern } from '../../config/AppConfig';

/** Per-face UV rectangles for a box: front, back, right, left, top, bottom. */
export function computeFaceUVs(sidePattern: TextureSidePattern, mirrorTopBottom: boolean): Vector4[] {
  const make = (flipU: boolean, flipV: boolean) => (
    flipU && flipV ? new Vector4(1, 1, 0, 0)
      : flipU ? new Vector4(1, 0, 0, 1)
      : flipV ? new Vector4(0, 1, 1, 0)
      : new Vector4(0, 0, 1, 1)
  );

  const sideFlips = sidePattern === 'alternating'
    ? [false, true, false, true]
    : [false, false, false, false];

  return [
    make(sideFlips[0], false), // front
    make(sideFlips[2], false), // back
    make(sideFlips[1], false), // right
    make(sideFlips[3], false), // left
    make(false, false), // top
    make(false, mirrorTopBottom), // bottom
  ];
}

/** Tiles: image on front and back (mirrored to keep orientation), sides take the image centre colour. */
export function buildTileFaceUVs(): Vector4[] {
  const front = new Vector4(0, 0, 1, 1);
  const back = new Vector4(1, 0, 0, 1); // mirror horizontal to keep orientation
  const blank = new Vector4(0.5, 0.5, 0.5, 0.5);
  return [front, back, blank, blank, blank, blank];
}
