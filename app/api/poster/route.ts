import { NextRequest, NextResponse } from 'next/server';

// 豆瓣海报接口 v4（纯 Vercel 版，不依赖 Cloudflare Worker）
// 浏览器 -> /api/poster?id=xxx -> wmdb 换取图片地址 -> 带 Referer 取图 -> Vercel CDN 缓存一年
// wmdb 查不到时返回「暂无海报」占位图，不再返回红色块。

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0';

// 查不到海报时的占位图（深灰 + 文字），替换原来的红色块
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#18181b"/><g fill="#52525b" font-family="sans-serif" text-anchor="middle"><text x="150" y="218" font-size="22">暂无海报</text><text x="150" y="248" font-size="12">No Poster</text></g></svg>`;

function placeholder() {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // 短缓存：wmdb 后续收录了该片，下次就能刷新成真图
      'Cache-Control': 'public, s-maxage=3600, max-age=3600',
    },
  });
}

// wmdb 的 ID -> 图片地址。API 结果交给 Vercel Data Cache 缓存 1 天，
// 避免 wmdb 的 10 秒 1 次限流拖慢页面。
async function getWmdbUrl(id: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.wmdb.tv/movie/api?id=${encodeURIComponent(id)}`,
      {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(15000),
        next: { revalidate: 86400 },
      }
    );
    if (!res.ok) return '';
    const json: any = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    // 优先中文条目；跳过 noposter.jpg
    for (const item of list) {
      const p = typeof item?.poster === 'string' ? item.poster : '';
      if (p.includes('img.wmdb.tv') && !p.includes('noposter')) return p;
    }
  } catch {}
  return '';
}

async function imageResponse(id: string): Promise<Response> {
  const posterUrl = await getWmdbUrl(id);
  if (!posterUrl) return placeholder();

  try {
    const imgRes = await fetch(posterUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://movie.douban.com/' },
      signal: AbortSignal.timeout(45000),
      cache: 'force-cache',
    });
    if (!imgRes.ok) return placeholder();
    return new Response(imgRes.body, {
      status: 200,
      headers: {
        'Content-Type': imgRes.headers.get('content-type') || 'image/jpeg',
        // 图片本身缓存在 Vercel 边缘节点一年，浏览器缓存 7 天
        'Cache-Control': 'public, s-maxage=31536000, max-age=604800, immutable',
      },
    });
  } catch {
    return placeholder();
  }
}

export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get('id') || '').trim();
  if (!/^\d{4,12}$/.test(id)) {
    return NextResponse.json({ poster: '' }, { status: 400 });
  }

  // mode=json 兼容旧调用
  const mode = request.nextUrl.searchParams.get('mode') || '';
  if (mode === 'json') {
    return NextResponse.json(
      { poster: `/api/poster?id=${id}` },
      { headers: { 'Cache-Control': 'public, s-maxage=604800, max-age=604800' } }
    );
  }

  return imageResponse(id);
}
