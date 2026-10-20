import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * Lets every element claim the nearest free slot of the target shape instead
 * of keeping its index: elements are served in the given order (the activation
 * order, so early elements get their nearest slots), and each searches outward
 * through a uniform grid of the slots. Paths get short and rarely cross.
 */
export function assignSlots(from: readonly Vector3[], slots: readonly Vector3[], order: Int32Array): Int32Array {
  const count = Math.min(from.length, slots.length);
  const result = new Int32Array(from.length).map((_, index) => index);
  if (count === 0) return result;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const s = slots[i];
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); minZ = Math.min(minZ, s.z);
    maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y); maxZ = Math.max(maxZ, s.z);
  }
  // Cells per axis follow the shape's proportions (a tall spiral gets more cells in y).
  const ex = Math.max(maxX - minX, 1e-3), ey = Math.max(maxY - minY, 1e-3), ez = Math.max(maxZ - minZ, 1e-3);
  const cellSize = Math.cbrt((ex * ey * ez) / count) || 1;
  const nx = Math.max(1, Math.ceil(ex / cellSize)), ny = Math.max(1, Math.ceil(ey / cellSize)), nz = Math.max(1, Math.ceil(ez / cellSize));
  const clampCell = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
  const cellX = (x: number) => clampCell(Math.floor((x - minX) / cellSize), nx);
  const cellY = (y: number) => clampCell(Math.floor((y - minY) / cellSize), ny);
  const cellZ = (z: number) => clampCell(Math.floor((z - minZ) / cellSize), nz);

  // Bucketed slot lists: cellStart/cellSlots (counting sort, no per-cell arrays).
  const cellCount = nx * ny * nz;
  const cellOfSlot = new Int32Array(count);
  const cellStart = new Int32Array(cellCount + 1);
  for (let i = 0; i < count; i += 1) {
    const s = slots[i];
    const c = cellX(s.x) + nx * (cellY(s.y) + ny * cellZ(s.z));
    cellOfSlot[i] = c;
    cellStart[c + 1] += 1;
  }
  for (let c = 0; c < cellCount; c += 1) cellStart[c + 1] += cellStart[c];
  const fill = cellStart.slice(0, cellCount);
  const cellSlots = new Int32Array(count);
  for (let i = 0; i < count; i += 1) cellSlots[fill[cellOfSlot[i]]++] = i;

  const taken = new Uint8Array(count);
  const maxRing = Math.max(nx, ny, nz);

  for (const element of order) {
    if (element >= count) continue;
    const p = from[element];
    // Elements outside the shape start searching at the nearest edge cell.
    const cx = cellX(p.x), cy = cellY(p.y), cz = cellZ(p.z);
    let best = -1;
    let bestDistance = Infinity;
    let foundAtRing = -1;
    for (let ring = 0; ring <= maxRing; ring += 1) {
      // A nearer slot can still sit in the ring after the first hit.
      if (foundAtRing >= 0 && ring > foundAtRing + 1) break;
      for (let dz = -ring; dz <= ring; dz += 1) {
        const z = cz + dz;
        if (z < 0 || z >= nz) continue;
        for (let dy = -ring; dy <= ring; dy += 1) {
          const y = cy + dy;
          if (y < 0 || y >= ny) continue;
          const onShellYZ = Math.abs(dz) === ring || Math.abs(dy) === ring;
          // Inner rows of the shell only need their two x ends.
          const step = onShellYZ ? 1 : Math.max(1, 2 * ring);
          for (let dx = -ring; dx <= ring; dx += step) {
            const x = cx + dx;
            if (x < 0 || x >= nx) continue;
            const c = x + nx * (y + ny * z);
            for (let k = cellStart[c]; k < cellStart[c + 1]; k += 1) {
              const slot = cellSlots[k];
              if (taken[slot]) continue;
              const s = slots[slot];
              const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
              if (d < bestDistance) {
                bestDistance = d;
                best = slot;
              }
            }
          }
        }
      }
      if (best >= 0 && foundAtRing < 0) foundAtRing = ring;
    }
    if (best < 0) {
      for (let slot = 0; slot < count; slot += 1) {
        if (!taken[slot]) {
          best = slot;
          break;
        }
      }
    }
    taken[best] = 1;
    result[element] = best;
  }
  return result;
}
