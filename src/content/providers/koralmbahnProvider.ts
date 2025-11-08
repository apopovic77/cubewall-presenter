import type { CubeContentLoadResult } from '../index';
import type { CubeLayoutConfig, CubeLayoutMode, CubeLayoutOrder } from '../../config/AppConfig';
import { fetchCubeContent } from '../../utils/contentApi';

const DEFAULT_MAX_ITEMS = 625;
const DEFAULT_AXIS_KEY = 'publishedDay';

function resolveLayoutOverrides(): Partial<CubeLayoutConfig> {
  const modeEnv = (import.meta.env.VITE_KORALMBAHN_LAYOUT_MODE ?? import.meta.env.VITE_CUBE_LAYOUT_MODE)?.toLowerCase();
  const axisEnv = (import.meta.env.VITE_KORALMBAHN_LAYOUT_AXIS ?? import.meta.env.VITE_CUBE_LAYOUT_AXIS)?.toLowerCase();
  const sortOrderEnv = (import.meta.env.VITE_KORALMBAHN_LAYOUT_SORT_ORDER ?? import.meta.env.VITE_CUBE_LAYOUT_SORT_ORDER)?.toLowerCase();
  const axisOrderEnv = (import.meta.env.VITE_KORALMBAHN_LAYOUT_AXIS_ORDER ?? import.meta.env.VITE_CUBE_LAYOUT_AXIS_ORDER)?.toLowerCase();
  const axisKeyEnv = import.meta.env.VITE_KORALMBAHN_LAYOUT_AXIS_KEY ?? import.meta.env.VITE_CUBE_LAYOUT_AXIS_KEY;

  const mode = modeEnv === 'matrix' ? 'matrix' : 'axis';
  const axis = axisEnv === 'columns' ? 'columns' : 'rows';
  const sortOrder: CubeLayoutOrder = sortOrderEnv === 'asc' ? 'asc' : 'desc';
  const axisOrder: CubeLayoutOrder = axisOrderEnv === 'asc' ? 'asc' : 'desc';
  const axisKey = (axisKeyEnv && axisKeyEnv.trim()) || DEFAULT_AXIS_KEY;

  const overrides: Partial<CubeLayoutConfig> = {
    mode: mode as CubeLayoutMode,
    axis,
    sortOrder,
    axisOrder,
    axisKey,
  };

  return overrides;
}

export async function loadKoralmbahnContent(): Promise<CubeContentLoadResult> {
  const maxItemsEnv = Number(
    import.meta.env.VITE_KORALMBAHN_MAX_ITEMS ?? import.meta.env.VITE_CUBE_CONTENT_MAX_ITEMS ?? DEFAULT_MAX_ITEMS,
  );
  const maxItems = Number.isFinite(maxItemsEnv) && maxItemsEnv > 0 ? Math.floor(maxItemsEnv) : DEFAULT_MAX_ITEMS;
  const items = await fetchCubeContent(maxItems);
  return {
    items,
    layout: resolveLayoutOverrides(),
  };
}

