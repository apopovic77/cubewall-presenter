import { normalizeCubeContent, type CubeContentItem } from '../types/content';

interface StorageObjectRef {
  id?: number | string | null;
  mime_type?: string | null;
  mimeType?: string | null;
}

interface CandidateMedia {
  url?: string | null;
  thumbnail_url?: string | null;
  storage_object?: StorageObjectRef | null;
}

interface CandidateItem {
  id: number | string;
  title?: string | null;
  summary?: string | null;
  ai_summary_de?: string | null;
  ai_summary_en?: string | null;
  raw_text?: string | null;
  url?: string | null;
  published_at?: string | null;
  source_name?: string | null;
  category?: string | null;
  media?: CandidateMedia[] | null;
}

interface CandidatesResponse {
  items?: CandidateItem[];
}

const globalCrypto: Crypto | undefined =
  typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;

const STORAGE_BASE_URL =
  (import.meta.env.VITE_KORALMBAHN_STORAGE_URL as string | undefined)?.replace(/\/+$/, '') ??
  'https://api-storage.arkturian.com';

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

function buildStorageMediaUrl(id: string | number, params?: Record<string, string | number | undefined>): string {
  const url = new URL(`${STORAGE_BASE_URL}/storage/media/${id}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function pickMediaUrl(media?: CandidateMedia[] | null): string | null {
  if (!media || media.length === 0) return null;

  for (const item of media) {
    const storageId = item?.storage_object?.id;
    const storageMime = (item?.storage_object?.mime_type ?? item?.storage_object?.mimeType ?? '').toLowerCase();

    if (storageId != null) {
      if (storageMime.startsWith('application/pdf')) {
        return buildStorageMediaUrl(storageId, { format: 'jpg', width: 600, quality: 85 });
      }
      return buildStorageMediaUrl(storageId, { format: 'jpg', width: 600, quality: 85 });
    }

    const candidate = item?.url ?? item?.thumbnail_url ?? null;
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeSnippet(value?: string | null): string {
  if (!value) return '';
  return stripHtml(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSummary(item: CandidateItem): string {
  const candidates = [
    item.ai_summary_de,
    item.summary,
    item.ai_summary_en,
    item.raw_text,
  ];
  for (const entry of candidates) {
    const normalized = normalizeSnippet(entry);
    if (normalized) {
      return normalized;
    }
  }
  return '';
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

function toTimestamp(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  return undefined;
}

function toDayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const year = parsed.getUTCFullYear();
  const month = `${parsed.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapCandidateToContent(item: CandidateItem, fallbackOrder: number): CubeContentItem {
  const publishedAt = item.published_at ?? null;
  const sortValue = toTimestamp(publishedAt);
  const publishedDay = toDayKey(publishedAt);

  return {
    id: createDeterministicId(item),
    title: item.title ?? 'Unbetitelter Beitrag',
    summary: extractSummary(item),
    url: item.url ?? '#',
    imageUrl: pickMediaUrl(item.media),
    publishedAt,
    sourceName: item.source_name ?? null,
    category: item.category ?? null,
    layout: {
      sortValue: sortValue ?? fallbackOrder,
      axisValues: publishedDay ? { publishedDay } : undefined,
    },
  };
}

const PAGE_SIZE = 200;

async function fetchPage(limit: number, offset: number, signal?: AbortSignal): Promise<CandidateItem[]> {
  const url = buildRequestUrl(limit, offset);
  console.info(`[CubeContent] fetchPage limit=${limit} offset=${offset} url=${url}`);
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal });
  } catch (error) {
    console.error('[CubeContent] request failed (network)', error);
    throw error;
  }
  if (!response.ok) {
    console.warn(`[CubeContent] request failed (${response.status}) at offset=${offset} limit=${limit}`);
    return [];
  }
  const payload = (await response.json()) as CandidatesResponse;
  const candidates = Array.isArray(payload.items) ? payload.items : [];
  return candidates;
}

export async function fetchCubeContent(maxItems = 625, options?: { signal?: AbortSignal }): Promise<CubeContentItem[]> {
  console.info(`[CubeContent] fetchCubeContent maxItems=${maxItems}`);
  const collected: CubeContentItem[] = [];
  let offset = 0;

  while (collected.length < maxItems) {
    const remaining = maxItems - collected.length;
    const pageLimit = Math.min(PAGE_SIZE, Math.max(remaining, 1));
    let items: CandidateItem[] = [];

    try {
      items = await fetchPage(pageLimit, offset, options?.signal);
    } catch (error) {
      console.warn('[CubeContent] failed to fetch page – aborting pagination.', error);
      break;
    }

    if (items.length === 0) {
      break;
    }

    const mapped = items.map((candidate, index) => mapCandidateToContent(candidate, offset + index));
    collected.push(...mapped);

    if (items.length < pageLimit) {
      break;
    }

    offset += items.length;
  }

  if (collected.length === 0) {
    console.warn('[CubeContent] API returned zero items.');
    return [];
  }

  const normalized = normalizeCubeContent(collected.slice(0, maxItems));
  const missingImages = normalized.filter((item) => !item.imageUrl);
  console.info(
    `[CubeContent] normalized=${normalized.length}, withImage=${normalized.length - missingImages.length}, missingImage=${missingImages.length}`,
  );
  if (missingImages.length > 0) {
    console.warn(
      '[CubeContent] Items without imageUrl:',
      missingImages.slice(0, 5).map(({ id, title }) => ({ id, title })),
    );
  }

  return normalized;
}


