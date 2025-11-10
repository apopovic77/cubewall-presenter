import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { BillboardDisplayState } from '../engine/CubeWallPresenter';
import type { PresenterSettings } from '../config/PresenterSettings';
import { appConfig } from '../config/AppConfig';

export interface HtmlBillboardProps {
  state: BillboardDisplayState;
  settings: PresenterSettings;
}

const CLAMP_MARGIN = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function buildHtml(template: string, state: BillboardDisplayState): string {
  if (!state.content) return template || '';
  const hasTokens =
    template && /\{\{\s*title\s*\}\}/.test(template) && /\{\{\s*summary\s*\}\}/.test(template);
  const fallbackTemplate = appConfig.billboard.htmlContent ?? '';
  let html = (hasTokens ? template : fallbackTemplate) || '';
  const replacements: Record<string, string | number> = {
    '{{gridX}}': state.content.gridX,
    '{{gridZ}}': state.content.gridZ,
    '{{color}}': state.content.colorHex,
    '{{texture}}': state.content.textureLabel,
  };

  const item = state.content.item;
  if (item) {
    const publishedDate = item.publishedAt ? new Date(item.publishedAt) : null;
    const publishedLabel = publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate.toLocaleDateString('de-DE') : '';
    replacements['{{title}}'] = escapeHtml(item.title ?? '');
    replacements['{{summary}}'] = escapeHtml(item.summary ?? '');
    replacements['{{url}}'] = escapeHtml(item.url ?? '');
    replacements['{{source}}'] = escapeHtml(item.sourceName ?? '');
    replacements['{{category}}'] = escapeHtml(item.category ?? '');
    replacements['{{imageUrl}}'] = escapeHtml(item.imageUrl ?? '');
    replacements['{{publishedAt}}'] = escapeHtml(publishedLabel);
  } else {
    replacements['{{title}}'] = '';
    replacements['{{summary}}'] = '';
    replacements['{{url}}'] = '';
    replacements['{{source}}'] = '';
    replacements['{{category}}'] = '';
    replacements['{{imageUrl}}'] = '';
    replacements['{{publishedAt}}'] = '';
  }

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
    </>
  );
}
