/**
 * Douban API Service Client
 *
 * 直接调用 kerkerker-douban-service 微服务 (前端直接调用，无代理层)
 * 服务地址通过环境变量 NEXT_PUBLIC_DOUBAN_API_URL 配置
 *
 * 图片修复：数据源缓存的图片域名 douban-images.aipan.me 已失效，
 * 本客户端在拿到数据后，用每条数据自带的豆瓣 ID 调 /api/poster
 * 换取 wmdb.tv 的有效海报并替换，一处覆盖全站所有豆瓣图片。
 */

const DOUBAN_API_URL = process.env.NEXT_PUBLIC_DOUBAN_API_URL || 'https://iamyourfather.link0.me'

// 已失效的图床域名（数据源服务端配置错误，我们无法修改）
const BROKEN_IMAGE_HOST = 'douban-images.aipan.me'
// 需要修复的图片字段
const IMAGE_FIELDS = ['cover', 'poster_horizontal', 'poster_vertical', 'img', 'image', 'thumb', 'poster']

/**
 * 递归扫描数据，用豆瓣 ID 换取有效海报替换失效图床地址。
 * 只在浏览器端执行（服务端无法请求相对路径 /api/poster）。
 */
function repairBrokenImages<T>(input: T): T {
  if (typeof window === 'undefined') return input

  // 图片版本号：改动后浏览器/MongoDB 缓存的旧图会立即失效，强制重新出图。
  // 若以后又需要强制刷新，把 3 改成 4、5……即可。
  const POSTER_V = '3';

  // 直接把失效图床地址指向本项目的 /api/poster?id=豆瓣ID
  // 图片二进制由 Vercel 代理 wmdb 取回并缓存在边缘节点，之后秒开
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    const id = typeof node.id === 'string' && /^\d{4,12}$/.test(node.id) ? node.id : ''
    if (!id) {
      Object.values(node).forEach(walk)
      return
    }
    let changed = false
    for (const f of IMAGE_FIELDS) {
      if (typeof node[f] === 'string' && node[f].includes(BROKEN_IMAGE_HOST)) {
        node[f] = `/api/poster?id=${id}&v=${POSTER_V}`
        changed = true
      }
    }
    if (!changed) Object.values(node).forEach(walk)
  }

  walk(input)
  return input
}

/**
 * 通用请求函数
 */
async function fetchFromService<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${DOUBAN_API_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const data = await response.json();

    // Go 服务的响应格式有两种：
    // 1. 包装格式: { code: 200, data: {...} }
    // 2. 直接格式: { id: ..., title: ... }
    const result = (data.code !== undefined && data.data !== undefined ? data.data : data) as T;

    // 清缓存类请求无需修复图片
    if (options?.method === 'DELETE') return result;

    return repairBrokenImages(result);
  } catch (error) {
    console.error(`Douban API error [${endpoint}]:`, error);
    throw error;
  }
}

// ==================== Hero Banner ====================

export interface HeroMovie {
  id: string;
  title: string;
  rate: string;
  cover: string;
  poster_horizontal: string;
  poster_vertical: string;
  url: string;
  episode_info?: string;
  genres?: string[];
  description?: string;
}

export async function getHeroMovies(): Promise<HeroMovie[]> {
  return fetchFromService<HeroMovie[]>('/api/v1/hero');
}

export async function clearHeroCache(): Promise<void> {
  await fetchFromService('/api/v1/hero', { method: 'DELETE' });
}

// ==================== Category ====================

export interface Subject {
  id: string;
  title: string;
  rate: string;
  cover: string;
  url: string;
  episode_info?: string;
}

export interface CategoryPagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface CategoryResponse {
  subjects: Subject[];
  pagination: CategoryPagination;
}

export async function getCategoryData(
  category: string,
  page: number = 1,
  limit: number = 20
): Promise<CategoryResponse> {
  return fetchFromService<CategoryResponse>(
    `/api/v1/category?category=${category}&page=${page}&limit=${limit}`
  );
}

export interface Top250Response {
  subjects: Subject[];
}

export async function getTop250(): Promise<Top250Response> {
  return fetchFromService<Top250Response>('/api/v1/250');
}

// ==================== Detail ====================

export interface SubjectDetail {
  id: string;
  title: string;
  rate: string;
  url: string;
  cover: string;
  types: string[];
  release_year: string;
  directors: string[];
  actors: string[];
  duration: string;
  region: string;
  episodes_count: string;
  short_comment?: {
    content: string;
    author: { name: string };
  };
  photos?: Array<{ id: string; image: string; thumb: string }>;
  comments?: Array<{ id: string; content: string; author: { name: string } }>;
  recommendations?: Subject[];
}

export async function getSubjectDetail(id: string): Promise<SubjectDetail | null> {
  try {
    return await fetchFromService<SubjectDetail>(`/api/v1/detail/${id}`);
  } catch {
    return null;
  }
}

export async function clearDetailCache(id: string): Promise<void> {
  await fetchFromService(`/api/v1/detail/${id}`, { method: 'DELETE' });
}

// ==================== Latest ====================

export interface CategoryData {
  name: string;
  data: Subject[];
}

export async function getLatestContent(): Promise<CategoryData[]> {
  return fetchFromService<CategoryData[]>('/api/v1/latest');
}

export async function clearLatestCache(): Promise<void> {
  await fetchFromService('/api/v1/latest', { method: 'DELETE' });
}

// ==================== Movies ====================

export async function getMoviesCategories(): Promise<CategoryData[]> {
  return fetchFromService<CategoryData[]>('/api/v1/movies');
}

export async function clearMoviesCache(): Promise<void> {
  await fetchFromService('/api/v1/movies', { method: 'DELETE' });
}

// ==================== TV ====================

export async function getTVCategories(): Promise<CategoryData[]> {
  return fetchFromService<CategoryData[]>('/api/v1/tv');
}

export async function clearTVCache(): Promise<void> {
  await fetchFromService('/api/v1/tv', { method: 'DELETE' });
}

// ==================== New ====================

export interface NewFilters {
  type?: string;
  year?: string;
  region?: string;
  genre?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface NewContentResponse {
  data: CategoryData[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export async function getNewContent(filters: NewFilters = {}): Promise<CategoryData[]> {
  const params = new URLSearchParams();
  if (filters.type) params.append('type', filters.type);
  if (filters.year) params.append('year', filters.year);
  if (filters.region) params.append('region', filters.region);
  if (filters.genre) params.append('genre', filters.genre);
  if (filters.sort) params.append('sort', filters.sort);
  if (filters.page) params.append('page', String(filters.page));
  if (filters.pageSize) params.append('pageSize', String(filters.pageSize));

  const queryString = params.toString();
  const endpoint = queryString ? `/api/v1/new?${queryString}` : '/api/v1/new';

  return fetchFromService<CategoryData[]>(endpoint);
}

export async function clearNewCache(): Promise<void> {
  await fetchFromService('/api/v1/new', { method: 'DELETE' });
}

// ==================== Search ====================

export interface SuggestItem {
  id: string;
  title: string;
  sub_title?: string;
  img: string;
  url: string;
  type: string;
  year?: string;
  episode?: string;
}

export interface SearchResult {
  suggest: SuggestItem[];
  advanced: Subject[];
}

export async function searchDouban(
  query: string,
  type?: 'movie' | 'tv',
  options: { sort?: string; genres?: string; yearRange?: string; start?: number; limit?: number } = {}
): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query });
  if (type) params.append('type', type);
  if (options.sort) params.append('sort', options.sort);
  if (options.genres) params.append('genres', options.genres);
  if (options.yearRange) params.append('year_range', options.yearRange);
  if (options.start) params.append('start', String(options.start));
  if (options.limit) params.append('limit', String(options.limit));

  return fetchFromService<SearchResult>(`/api/v1/search?${params.toString()}`);
}

export async function getSearchTags(type: 'movie' | 'tv'): Promise<string[]> {
  return fetchFromService<string[]>('/api/v1/search', {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
}

// ==================== Service Status ====================

export interface ServiceStatus {
  status: string;
  proxy_enabled: boolean;
  proxy_count: number;
  tmdb_enabled: boolean;
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  return fetchFromService<ServiceStatus>('/api/v1/status');
}

// ==================== Health Check ====================

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${DOUBAN_API_URL}/health`);
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * 获取 API 服务地址（供调试用）
 */
export function getDebugApiUrl(): string {
  return DOUBAN_API_URL;
}

// ==================== Calendar ====================

export interface CalendarEntry {
  show_id: number;
  show_name: string;
  show_name_cn?: string;
  season_number: number;
  episode_number: number;
  episode_name: string;
  air_date: string;
  poster: string;
  backdrop?: string;
  overview?: string;
  vote_average: number;
  douban_id?: string;
  douban_rating?: string;
}

export interface CalendarDay {
  date: string;
  entries: CalendarEntry[];
}

export interface CalendarResponse {
  start_date: string;
  end_date: string;
  days: CalendarDay[];
  total: number;
}

export interface CalendarFilters {
  start_date?: string;
  end_date?: string;
  region?: string;
}

export interface AiringFilters {
  page?: number;
  region?: string;
}

/**
 * 获取日历数据
 * @param filters 筛选参数
 */
export async function getCalendar(filters: CalendarFilters = {}): Promise<CalendarResponse> {
  const params = new URLSearchParams();
  if (filters.start_date) params.append('start_date', filters.start_date);
  if (filters.end_date) params.append('end_date', filters.end_date);

  const queryString = params.toString();
  const endpoint = queryString ? `/api/v1/calendar?${queryString}` : '/api/v1/calendar';

  return fetchFromService<CalendarResponse>(endpoint);
}

/**
 * 获取今日热播剧集
 * @param filters 筛选参数
 */
export async function getAiringToday(filters: AiringFilters = {}): Promise<CalendarEntry[]> {
  const params = new URLSearchParams();
  if (filters.page) params.append('page', String(filters.page));
  if (filters.region) params.append('region', filters.region);

  const queryString = params.toString();
  const endpoint = queryString ? `/api/v1/calendar/airing?${queryString}` : '/api/v1/calendar/airing';

  return fetchFromService<CalendarEntry[]>(endpoint);
}

/**
 * 清除日历缓存
 */
export async function clearCalendarCache(): Promise<void> {
  await fetchFromService('/api/v1/calendar', { method: 'DELETE' });
}
