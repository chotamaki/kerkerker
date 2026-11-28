import { NextRequest, NextResponse } from 'next/server';

// 豆瓣海报接口 · 由 Vercel 自带 CDN 加速（无需 Cloudflare）
// 浏览器请求 /api/poster?id=<豆瓣ID> 直接拿到图片二进制；
// 首次由本函数去 wmdb 换取并取回图片，之后 Vercel 边缘节点缓存一年，毫秒级返回。

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0';

// 同一实例内缓存 ID -> 图片URL，避免重复查 wmdb
const urlCache = new Map<string, { url: string; ts: number }>();
const URL_TTL = 6 * 60 * 60 * 1000; // 6 小时

// 1x1 透明 PNG（无图时返回，避免裂图）
const BLANK_PNG = new Uint8Array([
  137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,
  31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,
  145,0,0,0,65,116,69,88,116,0,0,0,0
]);

async function getWmdbUrl(id: string): Promise<string> {
  const hit = urlCache.get(id);
  if (hit && Date.now() - hit.ts < URL_TTL) return hit.url;
  try {
    const res = await fetch(
      `https://api.wmdb.tv/movie/api?id=${encodeURIComponent(id)}`,
      {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      }
    );
    if (!res.ok) throw new Error(`wmdb HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    let poster = '';
    for (const item of list) {
      const p = typeof item?.poster === 'string' ? item.poster : '';
      if (p.includes('img.wmdb.tv') && !p.includes('noposter')) {
        poster = p;
        break;
      }
    }
    urlCache.set(id, { url: poster, ts: Date.now() });
    return poster;
  } catch {
    return hit?.url || '';
  }
}

// 图片模式：返回图片二进制 + 长缓存（Vercel 边缘节点缓存一年）
async function imageResponse(id: string): Promise<Response> {
  const posterUrl = await getWmdbUrl(id);
  if (!posterUrl) {
    return new Response(BLANK_PNG, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, s-maxage=604800, max-age=604800',
      },
    });
  }
  try {
    const imgRes = await fetch(posterUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://movie.douban.com/' },
      signal: AbortSignal.timeout(45000),
      cache: 'force-cache',
    });
    if (!imgRes.ok) throw new Error(`img HTTP ${imgRes.status}`);
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    return new Response(imgRes.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // Vercel 边缘 CDN 缓存一年，浏览器也缓存 7 天
        'Cache-Control': 'public, s-maxage=31536000, max-age=604800, immutable',
      },
    });
  } catch {
    // 取图临时失败：短缓存后重试，不返回裂图
    return new Response(BLANK_PNG, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, s-maxage=60, max-age=60',
      },
    });
  }
}

export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get('id') || '').trim();
  if (!/^\d{4,12}$/.test(id)) {
    return NextResponse.json({ poster: '' }, { status: 400 });
  }

  // mode=json 兼容旧调用；默认返回图片二进制
  const mode = request.nextUrl.searchParams.get('mode') || '';
  if (mode === 'json') {
    const posterUrl = await getWmdbUrl(id);
    return NextResponse.json(
      { poster: posterUrl ? `/api/poster?id=${id}` : '' },
      { headers: { 'Cache-Control': 'public, s-maxage=604800, max-age=604800' } }
    );
  }

  return imageResponse(id);
}
