import { NextRequest, NextResponse } from 'next/server';

import {
  assertSafeOutboundUrl,
  UnsafeOutboundUrlError,
} from '@/lib/url-security';

// 图片代理：由「服务端抓取」改为「302 重定向」，让浏览器直连图片源。
// 原因：Vercel 免费版节点在海外，访问国内图床（douban-images.aipan.me 等）
// 会 DNS 解析失败或连接超时，服务端 fetch 必然 500。
// 改为 302 后，Vercel 不实际下载图片，只返回一个跳转，
// 图片由用户浏览器（国内网络）直接加载，可正常显示。
// 该路由被 DoubanCard / getImageUrl 等所有图片调用点共用，改这一处即全覆盖。

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get('url');

    if (!url) {
      return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
    }

    let safeUrl: URL;
    try {
      safeUrl = await assertSafeOutboundUrl(url);
    } catch (error) {
      // 明确被安全策略拦截（内网地址 / 非法协议）的，直接拒绝
      if (error instanceof UnsafeOutboundUrlError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      // 其余多为 DNS 解析失败：Vercel 海外节点对部分国内域名解析不稳定，
      // 且 302 重定向不会让服务端访问目标地址，不构成 SSRF，
      // 因此降级为仅校验协议后放行，交由浏览器直连。
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return NextResponse.json({ error: 'Blocked outbound URL protocol' }, { status: 400 });
      }
      safeUrl = parsed;
    }

    // 关键：302 重定向，浏览器直连图片源
    return NextResponse.redirect(safeUrl.toString(), 302);
  } catch (error) {
    console.error('Image proxy error:', error);
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }
}
