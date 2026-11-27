import { NextRequest, NextResponse } from 'next/server';

// 豆瓣海报换取接口
// 背景：原豆瓣数据服务(iamyourfather.link0.me)把自己缓存的图片域名
// 配成 douban-images.aipan.me，该域名已失效(DNS 无法解析)，导致全站图片 500。
// 数据里的 cover 是图片内容 SHA1，无法反推豆瓣原图；但每条数据都带豆瓣 ID，
// 本接口用豆瓣 ID 去 wmdb.tv 换取其抓取好的有效海报(img.wmdb.tv，国内可直连)。
// wmdb 覆盖约 80% 热门条目；取不到时返回空串，前端回退占位图，不影响其他功能。

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 同一 Serverless 实例内的内存缓存，避免同一 ID 被反复请求
const posterCache = new Map<string, string | null>();

export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get('id') || '').trim();

  if (!/^\d{4,12}$/.test(id)) {
    return NextResponse.json({ poster: '' }, { status: 400 });
  }

  if (posterCache.has(id)) {
    return NextResponse.json({ poster: posterCache.get(id) || '' });
  }

  try {
    const res = await fetch(
      `https://api.wmdb.tv/movie/api?id=${encodeURIComponent(id)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
        },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      throw new Error(`wmdb HTTP ${res.status}`);
    }

    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];

    // wmdb 返回中英文两条，优先中文；跳过 noposter.jpg
    let poster = '';
    for (const item of list) {
      const p = typeof item?.poster === 'string' ? item.poster : '';
      if (p.includes('img.wmdb.tv') && !p.includes('noposter')) {
        poster = p;
        break;
      }
    }

    posterCache.set(id, poster);
    return NextResponse.json({ poster });
  } catch (error) {
    console.warn('[poster] 换取失败:', id, error instanceof Error ? error.message : error);
    posterCache.set(id, null);
    return NextResponse.json({ poster: '' });
  }
}
