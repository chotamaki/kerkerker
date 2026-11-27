import { NextRequest, NextResponse } from "next/server";
import {
  assertSafeOutboundUrl,
  UnsafeOutboundUrlError,
} from "@/lib/url-security";
import { getShortsSourcesFromDB, getShortsSourceByKey } from "@/lib/shorts-sources-db";
import type { ShortDramaSource } from "@/types/shorts-source";

// Vercel Hobby 免费版函数默认 10 秒超时，国内源站响应慢会被强制杀掉返回 500。
// 提升到 60 秒（Hobby 上限），并关闭静态缓存，避免拿到过期数据。
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

export interface ShortsListResponse {
  code: number;
  msg: string;
  page: number;
  pagecount: number;
  total: number;
  list: ShortDrama[];
  source: string;
  sources: { key: string; name: string }[];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = searchParams.get("pg") || "1";
    const sourceKey = searchParams.get("source");

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

    // 构建候选源列表：优先用指定源/默认源，其余作为故障切换备用
    let primary: ShortDramaSource | null = null;
    if (sourceKey) {
      try {
        primary = await getShortsSourceByKey(sourceKey);
      } catch {
        primary = sources.find((s) => s.key === sourceKey) || null;
      }
    }
    if (!primary) {
      primary = sources[0];
    }
    const ordered = [primary, ...sources.filter((s) => s.key !== primary!.key)];

    const errors: string[] = [];

    // 依次尝试每个源，任意一个成功即返回；全部失败才报错
    for (const source of ordered) {
      try {
        const safeApiBase = (await assertSafeOutboundUrl(source.api)).toString();

        let apiUrl = `${safeApiBase}?pg=${page}`;
        if (source.typeId) {
          apiUrl += `&t=${source.typeId}`;
        }

        const response = await fetch(apiUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(50000), // 单源 50 秒内返回，留 10 秒给其他源切换
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`源站返回 HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data?.list)) {
          throw new Error("源站返回数据格式异常（无 list 字段）");
        }

        // 成功：把实际命中的源透传给前端，便于前端详情请求用同一个源
        return NextResponse.json({
          code: 200,
          msg: "success",
          data: {
            page: data.page,
            pagecount: data.pagecount,
            total: data.total,
            list: data.list.map((item: any) => ({
              vod_id: item.vod_id,
              vod_name: item.vod_name,
              vod_pic: item.vod_pic || "",
              vod_remarks: item.vod_remarks,
              vod_time: item.vod_time,
              type_name: item.type_name,
            })),
            source: source.key,
            sources: sources.map((s) => ({ key: s.key, name: s.name })),
          },
        });
      } catch (err) {
        if (err instanceof UnsafeOutboundUrlError) {
          errors.push(`${source.name}: ${err.message}`);
          continue;
        }
        const msg = err instanceof Error ? err.message : "未知错误";
        errors.push(`${source.name}: ${msg}`);
        console.warn(`[Shorts List] 源 ${source.key} 失败: ${msg}`);
      }
    }

    // 所有源都失败：把原因透传给前端，不再笼统报错
    return NextResponse.json(
      {
        code: 500,
        msg: `全部短剧源均不可用：${errors.join("；")}`,
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
    console.error("[Shorts List API Error]", error);
    const msg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { code: 500, msg: `获取短剧列表失败：${msg}`, data: null },
      { status: 500 }
    );
  }
}
