import { NextRequest, NextResponse } from 'next/server';

// 图片代理：兼容三种来源，统一交给 /api/poster 出图或直接跳转。
// 1) /api/poster?id=xxx —— 数据服务替换后的新地址（相对路径），本代理不认识会 400，
//    这里识别后直接 302 到 poster 接口，由 Vercel CDN 返回真实图片。
// 2) r_3?id=数字:1:1 等失效的豆瓣图片引用 —— 提取数字当豆瓣 ID 走 poster 接口。
// 3) http(s) 完整图片 URL —— 保持原来的 302 直连逻辑。
// 该路由被所有图片调用点共用，改这一处即全覆盖。

export const dynamic = 'force-dynamic';

// 1x1 透明 PNG：实在无法识别时返回，避免破图占位
const BLANK_PNG = new Uint8Array([
  137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,
  31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,
  145,0,0,0,65,116,69,88,116,0,0,0,0
]);

function blank() {
  return new Response(BLANK_PNG, {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  });
}

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get('url') || '').trim();
  if (!raw) {
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
  }

  // 尝试从各种形式里提取豆瓣 subject ID
  let doubanId = '';
  // 形式 1: /api/poster?id=36680492 （工具11替换后的新地址）
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
    // 统一 302 到 poster 接口，由它取图并交给 Vercel CDN 缓存
    return NextResponse.redirect(new URL(`/api/poster?id=${doubanId}`, request.url), 302);
  }

  // http(s) 完整图片 URL：保持原逻辑，浏览器直连
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return blank();
    return NextResponse.redirect(parsed.toString(), 302);
  } catch {
    // 无法识别的地址（失效图床残留等）：返回透明图，不再刷 400
    return blank();
  }
}
