import { NextRequest, NextResponse } from 'next/server';

// 图片代理 v3：兼容三种来源，统一交给 /api/poster 出图或直接跳转。
// 1) /api/poster?id=xxx —— 新地址，302 到 poster 接口。
// 2) r_3?id=数字:1:1 等失效豆瓣图片引用 —— 提取数字当豆瓣 ID 走 poster。
// 3) http(s) 完整图片 URL —— 保持 302 直连。
// 无法识别时返回「暂无海报」占位图（不再返回红色块，也不再刷 400）。
// 该路由被所有图片调用点共用，改这一处即全覆盖。

export const dynamic = 'force-dynamic';

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#18181b"/><g fill="#52525b" font-family="sans-serif" text-anchor="middle"><text x="150" y="218" font-size="22">暂无海报</text><text x="150" y="248" font-size="12">No Poster</text></g></svg>`;

function placeholder() {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get('url') || '').trim();
  if (!raw) {
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
  }

  // 尝试从各种形式里提取豆瓣 subject ID
  let doubanId = '';
  // 形式 1: /api/poster?id=36680492
  let m = raw.match(/\/api\/poster\?id=(\d{4,12})/);
  if (m) doubanId = m[1];
  // 形式 2: r_3?id=3035774681:1:1 等旧图片引用 / 豆瓣 subject 链接
  if (!doubanId) {
    m = raw.match(/(?:r_\d+\?id=|subject\/)(\d{4,12})/);
    if (m) doubanId = m[1];
  }
  // 形式 3: url 本身就是纯数字 ID
  if (!doubanId && /^\d{4,12}$/.test(raw)) doubanId = raw;

  if (doubanId) {
    return NextResponse.redirect(new URL(`/api/poster?id=${doubanId}`, request.url), 302);
  }

  // http(s) 完整图片 URL：保持原逻辑，浏览器直连
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return placeholder();
    return NextResponse.redirect(parsed.toString(), 302);
  } catch {
    return placeholder();
  }
}
