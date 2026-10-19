/**
 * AR menu content and layout, data first: the same item rectangles (canvas
 * pixels) drive painting and hit testing. Proportions follow the CloudV2 AR hand
 * menu (content post #5509): 1080 px square panel = 0.227 m.
 */

export const AR_MENU_CANVAS_PX = 1080;
export const AR_MENU_WORLD_SIZE_M = 0.227;

/** Everything the menu can trigger; the presenter maps these to the same calls as the keyboard shortcuts. */
export type ArMenuAction =
  | 'layout-matrix'
  | 'layout-masonry'
  | 'layout-axis'
  | 'auto-rotate'
  | 'morph'
  | 'line-wave'
  | 'wave-position'
  | 'wave-rotation'
  | 'physics-cycle'
  | 'next-cube'
  | 'random-cube'
  | 'place-field'
  | 'exit-ar';

export type ArPhysicsMode = 'off' | 'classic' | 'anchor';

/** Live state shown on the panel (selected toggles, physics mode). */
export interface ArMenuState {
  layoutMode: 'matrix' | 'masonry' | 'axis' | string;
  autoRotate: boolean;
  wavePosition: boolean;
  waveRotation: boolean;
  physicsMode: ArPhysicsMode;
}

export interface ArMenuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArMenuItem {
  action: ArMenuAction;
  label: string;
  detail?: string;
  rect: ArMenuRect;
  selected: boolean;
  tone: 'normal' | 'danger';
}

export interface ArMenuSection {
  title: string;
  y: number;
}

const PADDING = 48;
const GAP = 14;
const HALF_WIDTH = (AR_MENU_CANVAS_PX - PADDING * 2 - GAP) / 2;
const FULL_WIDTH = AR_MENU_CANVAS_PX - PADDING * 2;
const ROW_HEIGHT = 96;
const SECTION_TITLE_HEIGHT = 40;
const TITLE_BLOCK_HEIGHT = 92;

const PHYSICS_LABELS: Record<ArPhysicsMode, string> = {
  off: 'Aus · antippen: fallen lassen',
  classic: 'Fallen · antippen: Anker',
  anchor: 'Anker · antippen: aus',
};

interface RowSpec {
  section?: string;
  cells: Array<Omit<ArMenuItem, 'rect'>>;
}

function rows(state: ArMenuState): RowSpec[] {
  const item = (action: ArMenuAction, label: string, selected = false, detail?: string, tone: 'normal' | 'danger' = 'normal') => ({
    action,
    label,
    selected,
    detail,
    tone,
  });
  return [
    {
      section: 'Layout',
      cells: [item('layout-matrix', 'Raster', state.layoutMode === 'matrix'), item('layout-masonry', 'Masonry', state.layoutMode === 'masonry')],
    },
    { cells: [item('layout-axis', 'Zeitachse', state.layoutMode === 'axis'), item('auto-rotate', 'Auto-Rotation', state.autoRotate)] },
    { cells: [item('morph', 'Morph', false, 'nächste Form'), item('line-wave', 'Linienwelle')] },
    {
      section: 'Bewegung',
      cells: [item('wave-position', 'Welle', state.wavePosition), item('wave-rotation', 'Wellen-Drehung', state.waveRotation)],
    },
    { cells: [item('physics-cycle', 'Physik', state.physicsMode !== 'off', PHYSICS_LABELS[state.physicsMode])] },
    {
      section: 'Würfel und Feld',
      cells: [item('next-cube', 'Nächster Würfel'), item('random-cube', 'Zufälliger Würfel')],
    },
    { cells: [item('place-field', 'Feld vor mich'), item('exit-ar', 'AR beenden', false, undefined, 'danger')] },
  ];
}

export function buildArMenu(state: ArMenuState): { items: ArMenuItem[]; sections: ArMenuSection[] } {
  const items: ArMenuItem[] = [];
  const sections: ArMenuSection[] = [];
  let y = PADDING + TITLE_BLOCK_HEIGHT;
  rows(state).forEach((row) => {
    if (row.section) {
      sections.push({ title: row.section, y });
      y += SECTION_TITLE_HEIGHT;
    }
    const width = row.cells.length === 1 ? FULL_WIDTH : HALF_WIDTH;
    row.cells.forEach((cell, column) => {
      items.push({ ...cell, rect: { x: PADDING + column * (HALF_WIDTH + GAP), y, width, height: ROW_HEIGHT } });
    });
    y += ROW_HEIGHT + GAP;
  });
  return { items, sections };
}

export function menuItemAt(items: ArMenuItem[], px: number, py: number): ArMenuItem | null {
  return (
    items.find(({ rect }) => px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height) ?? null
  );
}
