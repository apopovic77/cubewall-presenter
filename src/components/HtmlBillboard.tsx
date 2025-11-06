import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { BillboardDisplayState } from '../engine/CubeWallPresenter';
import type { PresenterSettings } from '../config/PresenterSettings';

export interface HtmlBillboardProps {
  state: BillboardDisplayState;
  settings: PresenterSettings;
}

const CLAMP_MARGIN = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildHtml(template: string, state: BillboardDisplayState): string {
  if (!state.content) return template || '';
  let html = template || '';
  const replacements: Record<string, string | number> = {
    '{{gridX}}': state.content.gridX,
    '{{gridZ}}': state.content.gridZ,
    '{{color}}': state.content.colorHex,
    '{{texture}}': state.content.textureLabel,
  };
  Object.entries(replacements).forEach(([token, value]) => {
    html = html.replaceAll(token, String(value));
  });
  return html.replace(/\n/g, '<br/>');
}

export function HtmlBillboard({ state, settings }: HtmlBillboardProps) {
  const html = useMemo(() => buildHtml(settings.billboardHtmlContent, state), [settings.billboardHtmlContent, state]);

  if (!state.content) {
    return null;
  }

  const clampedX = clamp(state.screenX, CLAMP_MARGIN, state.viewportWidth - CLAMP_MARGIN);
  const clampedY = clamp(state.screenY, CLAMP_MARGIN, state.viewportHeight - CLAMP_MARGIN);
  const lineStartX = clamp(state.cubeScreenX, 0, state.viewportWidth);
  const lineStartY = clamp(state.cubeScreenY + 30, 0, state.viewportHeight);
  const lineEndX = clampedX;
  const lineEndY = clampedY + 24;
  const connectorValid = Number.isFinite(lineStartX) && Number.isFinite(lineStartY) && Number.isFinite(lineEndX) && Number.isFinite(lineEndY);

  return (
    <>
      <AnimatePresence>
        {state.isVisible && (
          <motion.div
            className="cw-html-billboard"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', damping: 20, stiffness: 220 }}
            style={{ left: clampedX, top: clampedY }}
          >
            <button type="button" className="cw-html-billboard__close" onClick={state.onRequestClose}>
              ×
            </button>
            <div className="cw-html-billboard__content" dangerouslySetInnerHTML={{ __html: html }} />
          </motion.div>
        )}
      </AnimatePresence>
      {state.isVisible && connectorValid && (
        <svg className="cw-html-billboard__connector" width={state.viewportWidth} height={state.viewportHeight}>
          <line x1={lineStartX} y1={lineStartY} x2={lineEndX} y2={lineEndY} />
        </svg>
      )}
    </>
  );
}
