import type { CubeContentItem } from '../types/content';
import type { CubeLayoutConfig } from '../config/AppConfig';
import { loadDefaultContent } from './providers/defaultProvider';
import { loadKoralmbahnContent } from './providers/koralmbahnProvider';

export type ContentProviderId = 'default' | 'koralmbahn';

export interface CubeContentLoadResult {
  items: CubeContentItem[];
  layout?: Partial<CubeLayoutConfig>;
}

type ProviderLoader = () => Promise<CubeContentLoadResult>;

const PROVIDERS: Record<ContentProviderId, ProviderLoader> = {
  default: loadDefaultContent,
  koralmbahn: loadKoralmbahnContent,
};

export async function loadCubeContent(providerId?: string): Promise<CubeContentLoadResult> {
  const normalized = providerId?.toLowerCase() ?? 'default';
  const provider = (PROVIDERS as Record<string, ProviderLoader>)[normalized] ?? PROVIDERS.default;
  try {
    return await provider();
  } catch (error) {
    console.warn(`[CubeContent] provider "${normalized}" failed, falling back to default.`, error);
    if (provider !== PROVIDERS.default) {
      try {
        return await PROVIDERS.default();
      } catch (fallbackError) {
        console.error('[CubeContent] default provider failed.', fallbackError);
      }
    }
    return { items: [], layout: undefined };
  }
}

export function resolveContentProviderId(): ContentProviderId {
  const env = import.meta.env.VITE_CUBE_CONTENT_PROVIDER;
  const normalized = env?.toLowerCase();
  if (normalized === 'koralmbahn') {
    return 'koralmbahn';
  }
  if (import.meta.env.DEV) {
    return 'koralmbahn';
  }
  return 'default';
}

