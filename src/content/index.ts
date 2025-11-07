import type { CubeContentItem } from '../types/content';
import { loadDefaultContent } from './providers/defaultProvider';
import { loadKoralmbahnContent } from './providers/koralmbahnProvider';

export type ContentProviderId = 'default' | 'koralmbahn';

type ProviderLoader = () => Promise<CubeContentItem[]>;

const PROVIDERS: Record<ContentProviderId, ProviderLoader> = {
  default: loadDefaultContent,
  koralmbahn: loadKoralmbahnContent,
};

export async function loadCubeContent(providerId?: string): Promise<CubeContentItem[]> {
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
    return [];
  }
}

export function resolveContentProviderId(): ContentProviderId {
  const env = import.meta.env.VITE_CUBE_CONTENT_PROVIDER;
  const normalized = env?.toLowerCase();
  if (normalized === 'koralmbahn') {
    return 'koralmbahn';
  }
  return 'default';
}

