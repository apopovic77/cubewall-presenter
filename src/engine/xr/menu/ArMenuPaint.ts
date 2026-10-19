import { AR_MENU_CANVAS_PX, type ArMenuAction, type ArMenuItem, type ArMenuSection } from './ArMenuModel';

/** Palette of the CloudV2 AR menu (#5509): dark panel, bright text, cyan accent. */
const PALETTE = {
  backgroundTop: '#1c3043',
  backgroundBottom: '#101c2b',
  border: '#34495c',
  row: '#203346',
  rowHover: '#304b61',
  rowPressed: '#3f6277',
  rowSelected: '#294653',
  text: '#f0f6fc',
  muted: '#a9bbce',
  accent: '#9ae6ed',
  danger: '#f3b7ae',
};
const FONT = 'system-ui, sans-serif';

export interface ArMenuPaintInput {
  title: string;
  items: ArMenuItem[];
  sections: ArMenuSection[];
  hovered: ArMenuAction | null;
  pressed: ArMenuAction | null;
}

/** Paints the whole menu into a 1080 px square canvas (renderer-independent). */
export function paintArMenu(ctx: CanvasRenderingContext2D, input: ArMenuPaintInput): void {
  const size = AR_MENU_CANVAS_PX;
  ctx.clearRect(0, 0, size, size);

  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, PALETTE.backgroundTop);
  gradient.addColorStop(0.65, PALETTE.backgroundBottom);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(1, 1, size - 2, size - 2, 52);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.border;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.text;
  ctx.font = `600 44px ${FONT}`;
  ctx.fillText(input.title, 48, 48 + 30);
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `26px ${FONT}`;
  ctx.fillText('Zeigen + Pinch oder antippen', 48, 48 + 72);

  input.sections.forEach((section) => {
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(section.title.toUpperCase(), 52, section.y + 20);
  });

  input.items.forEach((item) => paintItem(ctx, item, input.hovered === item.action, input.pressed === item.action));
}

function paintItem(ctx: CanvasRenderingContext2D, item: ArMenuItem, isHovered: boolean, isPressed: boolean): void {
  const { x, y, width, height } = item.rect;
  ctx.fillStyle = isPressed ? PALETTE.rowPressed : isHovered ? PALETTE.rowHover : item.selected ? PALETTE.rowSelected : PALETTE.row;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 18);
  ctx.fill();

  if (item.selected) {
    ctx.fillStyle = PALETTE.accent;
    ctx.fillRect(x + 20, y + height - 8, width - 40, 4);
  }

  const textX = x + 24;
  const maxWidth = width - 48;
  ctx.fillStyle = item.tone === 'danger' ? PALETTE.danger : PALETTE.text;
  ctx.font = `550 37px ${FONT}`;
  if (item.detail) {
    ctx.fillText(fit(ctx, item.label, maxWidth), textX, y + height * 0.32);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `27px ${FONT}`;
    ctx.fillText(fit(ctx, item.detail, maxWidth), textX, y + height * 0.66);
  } else {
    ctx.fillText(fit(ctx, item.label, maxWidth), textX, y + height / 2);
  }
}

/** Shortens with an ellipsis instead of wrapping. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end)}…`;
}
