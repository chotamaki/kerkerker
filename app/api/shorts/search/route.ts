import { NextRequest, NextResponse } from "next/server";
import {
  assertSafeOutboundUrl,
  UnsafeOutboundUrlError,
} from "@/lib/url-security";
import {
  getShortsSourcesFromDB,
  getShortsSourceByKey,
} from "@/lib/shorts-sources-db";
import type { ShortDramaSource } from "@/types/shorts-source";

// Vercel Hobby 上限 60 秒
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export interface ShortDrama {
  vod_id: number;
  vod_name: string;
  vod_pic: string;
  vod_remarks: string;
  vod_time: string;
  type_name: string;
}

// 短剧关键词搜索：苹果 CMS V10 标准为 ac=detail&wd=关键词
// 逐个源尝试，任一源返回结果即返回；全部失败才报错（原因透传）。
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const keyword = (searchParams.get("wd") || "").trim();
    const sourceKey = searchParams.get("source");

    if (!keyword) {
      return NextResponse.json(
        { code: 400, msg: "请输入搜索关键词", data: null },
        { status: 400 }
      );
    }

    let sources: ShortDramaSource[];
    try {
      sources = await getShortsSourcesFromDB();
    } catch {
      sources = [];
    }

    if (sources.length === 0) {
      return NextResponse.json(
        { code: 404, msg: "暂未配置短剧源，请先在后台添加短剧源", data: null },
        { status: 404 }
      );
    }

    // 优先用指定源，其余作为备用
    let primary: ShortDramaSource | null = null;
    if (sourceKey) {
      try {
        primary = await getShortsSourceByKey(sourceKey);
      } catch {
        primary = sources.find((s) => s.key === sourceKey) || null;
      }
    }
    if (!primary) primary = sources[0];
    const ordered = [primary, ...sources.filter((s) => s.key !== primary!.key)];

    const errors: string[] = [];
    const encoded = encodeURIComponent(keyword);

    for (const source of ordered) {
      try {
        const safeApiBase = (await assertSafeOutboundUrl(source.api)).toString();

        // 苹果 CMS 搜索参数有多种写法，依次尝试，取第一个有结果的
        const queryVariants = [
          `?ac=detail&wd=${encoded}`,
          `?wd=${encoded}&ac=detail`,
          `?ac=videolist&wd=${encoded}`,
        ];

        for (const variant of queryVariants) {
          try {
            const apiUrl = `${safeApiBase}${variant}`;
            const response = await fetch(apiUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
              signal: AbortSignal.timeout(15000),
              cache: "no-store",
            });

            if (!response.ok) {
              throw new Error(`源站返回 HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!Array.isArray(data?.list) || data.list.length === 0) {
              continue; // 换下一种参数写法
            }

            const list: ShortDrama[] = data.list.map((item: any) => ({
              vod_id: item.vod_id,
              vod_name: item.vod_name,
              vod_pic: item.vod_pic || "",
              vod_remarks: item.vod_remarks || "",
              vod_time: item.vod_time || "",
              type_name: item.type_name || "",
            }));

            // 针对 typeId 的源，若搜索结果混入了非短剧内容，保留但前端可自行判断
            return NextResponse.json({
              code: 200,
              msg: "success",
              data: {
                keyword,
                list,
                source: source.key,
                sources: sources.map((s) => ({ key: s.key, name: s.name })),
              },
            });
          } catch (innerErr) {
            // 该参数写法失败，继续尝试下一种
            continue;
          }
        }

        errors.push(`${source.name}: 未搜到结果或搜索接口不支持`);
      } catch (err) {
        if (err instanceof UnsafeOutboundUrlError) {
          errors.push(`${source.name}: ${err.message}`);
          continue;
        }
        const msg = err instanceof Error ? err.message : "未知错误";
        errors.push(`${source.name}: ${msg}`);
        console.warn(`[Shorts Search] 源 ${source.key} 失败: ${msg}`);
      }
    }

    return NextResponse.json(
      {
        code: 500,
        msg: `搜索失败：${errors.join("；")}`,
        data: null,
      },
      { status: 500 }
    );
  } catch (error) {
    if (error instanceof UnsafeOutboundUrlError) {
      return NextResponse.json(
        { code: error.status, msg: error.message, data: null },
        { status: error.status }
      );
    }
    console.error("[Shorts Search API Error]", error);
    const msg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { code: 500, msg: `搜索失败：${msg}`, data: null },
      { status: 500 }
    );
  }
}
