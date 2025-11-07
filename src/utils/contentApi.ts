import { normalizeCubeContent, type CubeContentItem } from '../types/content';

interface CandidateMedia {
  url?: string | null;
  thumbnail_url?: string | null;
}

interface CandidateItem {
  id: number | string;
  title?: string | null;
  summary?: string | null;
  url?: string | null;
  published_at?: string | null;
  source_name?: string | null;
  category?: string | null;
  media?: CandidateMedia[] | null;
}

interface CandidatesResponse {
  items?: CandidateItem[];
}

const globalCrypto: Crypto | undefined = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;

function resolveApiBaseUrl(): string {
  const explicit = import.meta.env.VITE_KORALMBAHN_API_URL;
  if (explicit && explicit.length > 0) {
    return explicit.replace(/\/?$/, '');
  }

  if (import.meta.env.DEV) {
    return 'http://localhost:8080';
  }

  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }

  return '';
}

function buildRequestUrl(limit: number, offset: number): string {
  const base = resolveApiBaseUrl();
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.append('status', 'imported');
  params.append('category', 'news');
  params.append('category', 'research');
  params.append('category', 'official');
  params.append('category', 'media');
  params.append('category', 'other');
  return `${base}/admin/candidates?${params.toString()}`;
}

function pickMediaUrl(media?: CandidateMedia[] | null): string | null {
  if (!media || media.length === 0) return null;
  const primary = media[0]?.url || media[0]?.thumbnail_url;
  if (primary) return primary;
  const fallback = media.find((m) => m.url || m.thumbnail_url);
  return fallback?.url ?? fallback?.thumbnail_url ?? null;
}

function createDeterministicId(item: CandidateItem): string {
  if (item.id !== undefined && item.id !== null) {
    return String(item.id);
  }
  if (item.url) {
    return item.url;
  }
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  return `item-${Math.random().toString(36).slice(2, 10)}`;
}

function mapCandidateToContent(item: CandidateItem): CubeContentItem {
  return {
    id: createDeterministicId(item),
    title: item.title ?? 'Unbetitelter Beitrag',
    summary: item.summary ?? '',
    url: item.url ?? '#',
    imageUrl: pickMediaUrl(item.media),
    publishedAt: item.published_at ?? null,
    sourceName: item.source_name ?? null,
    category: item.category ?? null,
  };
}

export async function fetchCubeContent(limit = 900): Promise<CubeContentItem[]> {
  const url = buildRequestUrl(limit, 0);
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      console.warn(`[CubeContent] request failed (${response.status}) – falling back to defaults.`);
      return [];
    }
    const payload = (await response.json()) as CandidatesResponse;
    const candidates = Array.isArray(payload.items) ? payload.items : [];
    if (candidates.length === 0) {
      return [];
    }
    const mapped = candidates.map(mapCandidateToContent);
    return normalizeCubeContent(mapped);
  } catch (error) {
    console.warn('[CubeContent] failed to load content from API – falling back to defaults.', error);
    return [];
  }
}


