import { NextRequest, NextResponse } from 'next/server';

// 豆瓣海报接口 v5（双图源）
// 主图源：wmdb（快、有 CDN 缓存）；备用图源：豆瓣移动端页面直接抓 s_ratio_poster 原图
// wmdb 返回 noposter 的冷门片/新片，自动走备用图源，覆盖率接近 100%。
// 两个来源都失败时返回「暂无海报」占位图。

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#18181b"/><g fill="#52525b" font-family="sans-serif" text-anchor="middle"><text x="150" y="218" font-size="22">暂无海报</text><text x="150" y="248" font-size="12">No Poster</text></g></svg>`;

function placeholder() {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, max-age=3600',
    },
  });
}

// 图片二进制 -> 响应（Vercel 边缘缓存一年）
function imageResp(res: Response): Response {
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, s-maxage=31536000, max-age=604800, immutable',
    },
  });
}

// 主图源：wmdb
async function fromWmdb(id: string): Promise<Response | null> {
  try {
    const res = await fetch(`https://api.wmdb.tv/movie/api?id=${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    let poster = '';
    for (const item of list) {
      const p = typeof item?.poster === 'string' ? item.poster : '';
      if (p.includes('img.wmdb.tv') && !p.includes('noposter')) {
        poster = p;
        break;
      }
    }
    if (!poster) return null;
    const img = await fetch(poster, {
      headers: { 'User-Agent': UA, 'Referer': 'https://movie.douban.com/' },
      signal: AbortSignal.timeout(45000),
      cache: 'force-cache',
    });
    return img.ok ? imageResp(img) : null;
  } catch {
    return null;
  }
}

// 备用图源：豆瓣移动端页面 -> og:image / s_ratio_poster
async function fromDouban(id: string): Promise<Response | null> {
  try {
    const page = await fetch(`https://m.douban.com/movie/subject/${id}/`, {
      headers: { 'User-Agent': MOBILE_UA, Referer: 'https://m.douban.com/' },
      signal: AbortSignal.timeout(20000),
      next: { revalidate: 604800 },
    });
    if (!page.ok) return null;
    const html = await page.text();
    // 优先 s_ratio_poster（竖版海报，无签名参数，最稳）
    let m = html.match(/https?:\/\/img\d+\.doubanio\.com\/view\/photo\/s_ratio_poster\/public\/p\d+\.jpg/);
    if (!m) {
      // 退而求其次：og:image（qnmob 签名链接）
      m = html.match(/property="og:image"\s+content="([^"]+)"/);
    }
    const url = m ? (m[1] || m[0]).replace(/&amp;/g, '&') : '';
    if (!url) return null;
    const img = await fetch(url, {
      headers: { 'User-Agent': MOBILE_UA, Referer: 'https://m.douban.com/' },
      signal: AbortSignal.timeout(30000),
      cache: 'force-cache',
    });
    return img.ok && (img.headers.get('content-type') || '').startsWith('image/') ? imageResp(img) : null;
  } catch {
    return null;
  }
}

async function imageResponse(id: string): Promise<Response> {
  // 1) wmdb 优先（快且已缓存）
  const primary = await fromWmdb(id);
  if (primary) return primary;

  // 2) 备用：豆瓣移动端原图
  const fallback = await fromDouban(id);
  if (fallback) return fallback;

  // 3) 都没有：占位图
  return placeholder();
}

export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get('id') || '').trim();
  if (!/^\d{4,12}$/.test(id)) {
    return NextResponse.json({ poster: '' }, { status: 400 });
  }

  const mode = request.nextUrl.searchParams.get('mode') || '';
  if (mode === 'json') {
    return NextResponse.json(
      { poster: `/api/poster?id=${id}` },
      { headers: { 'Cache-Control': 'public, s-maxage=604800, max-age=604800' } }
    );
  }

  return imageResponse(id);
}
