import type { CubeCell } from '../CubeField';

/** Glass text tiles (captions) are not selectable; cubes and image tiles are. */
export function isSelectableCell(cell: CubeCell): boolean {
  return cell.tileDescriptor?.kind !== 'glassText';
}

export function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}
