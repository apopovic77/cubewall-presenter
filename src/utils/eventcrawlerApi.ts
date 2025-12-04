/**
 * EventCrawler v2 API Client
 *
 * Fetches events from the EventCrawler v2 API and maps them to CubeContentItem format.
 * API Docs: https://eventcrawler-api.arkturian.com/docs
 */
import { normalizeCubeContent, type CubeContentItem } from '../types/content';

// ============================================================================
// Types - EventCrawler v2 API Response
// ============================================================================

interface EventResponse {
  id: number | null;
  event_uuid: string;
  source_id: number;
  source_name: string | null;
  title_de: string;
  title_en: string | null;
  subtitle: string | null;
  url: string;
  original_url: string | null;
  resolved_url: string | null;
  summary_de: string;
  summary_en: string | null;
  markdown_summary: string | null;
  markdown_body: string | null;
  published_at: string;
  ingested_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  sentiment: number | null;
  importance: string;
  relevance_score: number | null;
  relevance_confidence: number | null;
  tags: string | null;
  media_refs: string | null;
  hero_image_storage_id: number | null;
  screenshot_storage_id: number | null;
}

interface EventChangesResponse {
  created: EventResponse[];
  updated: EventResponse[];
  deleted: number[];
  server_time: string;
}

// ============================================================================
// Configuration
// ============================================================================

const EVENTCRAWLER_API_BASE_URL =
  (import.meta.env.VITE_EVENTCRAWLER_API_URL as string | undefined)?.replace(/\/+$/, '') ??
  'https://eventcrawler-api.arkturian.com';

const STORAGE_BASE_URL =
  (import.meta.env.VITE_STORAGE_API_URL as string | undefined)?.replace(/\/+$/, '') ??
  'https://api-storage.arkturian.com';

// ============================================================================
// Helper Functions
// ============================================================================

function buildStorageMediaUrl(
  storageId: number,
  params?: Record<string, string | number | undefined>
): string {
  const url = new URL(`${STORAGE_BASE_URL}/storage/media/${storageId}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function resolveImageUrl(event: EventResponse): string | null {
  // Prefer hero_image, fallback to screenshot
  const storageId = event.hero_image_storage_id ?? event.screenshot_storage_id;
  if (storageId != null) {
    return buildStorageMediaUrl(storageId, {
      format: 'jpg',
      width: 600,
      quality: 85,
    });
  }
  return null;
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

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeText(value?: string | null): string {
  if (!value) return '';
  return stripHtml(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTags(tagsString: string | null): string | null {
  if (!tagsString) return null;
  // Tags might be JSON array or comma-separated
  try {
    const parsed = JSON.parse(tagsString);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0];
    }
  } catch {
    // Fallback: comma-separated
    const first = tagsString.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

// ============================================================================
// Mapping Function
// ============================================================================

function mapEventToContent(event: EventResponse, fallbackOrder: number): CubeContentItem {
  const publishedAt = event.published_at ?? null;
  const sortValue = toTimestamp(publishedAt);
  const publishedDay = toDayKey(publishedAt);

  // Extract category from importance or tags
  const category = event.importance !== 'normal' ? event.importance : parseTags(event.tags);

  return {
    id: event.event_uuid,
    title: event.title_de || 'Unbetitelter Beitrag',
    summary: normalizeText(event.summary_de),
    url: event.url || '#',
    imageUrl: resolveImageUrl(event),
    publishedAt,
    sourceName: event.source_name ?? null,
    category,
    layout: {
      sortValue: sortValue ?? fallbackOrder,
      axisValues: publishedDay ? { publishedDay } : undefined,
    },
  };
}

// ============================================================================
// API Client Functions
// ============================================================================

const PAGE_SIZE = 200;

async function fetchEventsPage(
  limit: number,
  offset: number,
  signal?: AbortSignal
): Promise<EventResponse[]> {
  const url = new URL(`${EVENTCRAWLER_API_BASE_URL}/api/v1/events/`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  console.info(`[EventCrawler] fetchEventsPage limit=${limit} offset=${offset} url=${url}`);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error('[EventCrawler] request failed (network)', error);
    throw error;
  }

  if (!response.ok) {
    console.warn(
      `[EventCrawler] request failed (${response.status}) at offset=${offset} limit=${limit}`
    );
    return [];
  }

  const events = (await response.json()) as EventResponse[];
  return Array.isArray(events) ? events : [];
}

/**
 * Fetch events from EventCrawler v2 API
 *
 * @param maxItems Maximum number of events to fetch
 * @param options Fetch options (e.g., AbortSignal)
 * @returns Array of CubeContentItem
 */
export async function fetchEventCrawlerContent(
  maxItems = 625,
  options?: { signal?: AbortSignal }
): Promise<CubeContentItem[]> {
  console.info(`[EventCrawler] fetchEventCrawlerContent maxItems=${maxItems}`);
  const collected: CubeContentItem[] = [];
  let offset = 0;

  while (collected.length < maxItems) {
    const remaining = maxItems - collected.length;
    const pageLimit = Math.min(PAGE_SIZE, Math.max(remaining, 1));
    let events: EventResponse[] = [];

    try {
      events = await fetchEventsPage(pageLimit, offset, options?.signal);
    } catch (error) {
      console.warn('[EventCrawler] failed to fetch page – aborting pagination.', error);
      break;
    }

    if (events.length === 0) {
      break;
    }

    const mapped = events.map((event, index) => mapEventToContent(event, offset + index));
    collected.push(...mapped);

    if (events.length < pageLimit) {
      break;
    }

    offset += events.length;
  }

  if (collected.length === 0) {
    console.warn('[EventCrawler] API returned zero events.');
    return [];
  }

  const normalized = normalizeCubeContent(collected.slice(0, maxItems));
  const missingImages = normalized.filter((item) => !item.imageUrl);
  console.info(
    `[EventCrawler] normalized=${normalized.length}, withImage=${normalized.length - missingImages.length}, missingImage=${missingImages.length}`
  );

  if (missingImages.length > 0) {
    console.warn(
      '[EventCrawler] Events without imageUrl:',
      missingImages.slice(0, 5).map(({ id, title }) => ({ id, title }))
    );
  }

  return normalized;
}

/**
 * Fetch event changes since a given timestamp (for delta sync)
 *
 * @param since ISO 8601 timestamp
 * @param signal AbortSignal
 * @returns EventChangesResponse with created, updated, deleted events
 */
export async function fetchEventChanges(
  since: string,
  signal?: AbortSignal
): Promise<EventChangesResponse> {
  const url = new URL(`${EVENTCRAWLER_API_BASE_URL}/api/v1/events/changes`);
  url.searchParams.set('since', since);

  const response = await fetch(url.toString(), {
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`EventCrawler changes API failed: ${response.status}`);
  }

  return (await response.json()) as EventChangesResponse;
}
