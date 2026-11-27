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

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export interface Episode {
  name: string;
  url: string;
}

export interface ShortDramaDetail {
  vod_id: number;
  vod_name: string;
  vod_pic: string;
  vod_remarks: string;
  vod_blurb: string;
  vod_actor: string;
  vod_director: string;
  vod_area: string;
  vod_year: string;
  type_name: string;
  episodes: Episode[];
  source: string;
}

// 解析播放地址字符串
function parsePlayUrl(playUrl: string): Episode[] {
  if (!playUrl) return [];

  const episodes: Episode[] = [];
  const parts = playUrl.split("#");

  for (const part of parts) {
    if (!part.trim()) continue;
    const [name, url] = part.split("$");
    if (name && url) {
      episodes.push({ name: name.trim(), url: url.trim() });
    }
  }

  return episodes;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ids = searchParams.get("ids");
    const sourceKey = searchParams.get("source");

    if (!ids) {
      return NextResponse.json(
        { code: 400, msg: "缺少 ids 参数", data: null },
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
        { code: 404, msg: "暂未配置短剧源", data: null },
        { status: 404 }
      );
    }

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

    for (const source of ordered) {
      try {
        const safeApiBase = (await assertSafeOutboundUrl(source.api)).toString();
        const apiUrl = `${safeApiBase}?ac=detail&ids=${ids}`;

        const response = await fetch(apiUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(50000),
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`源站返回 HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.list || data.list.length === 0) {
          throw new Error("该源无此短剧（继续尝试其他源）");
        }

        const item = data.list[0];
        const episodes = parsePlayUrl(item.vod_play_url);

        const detail: ShortDramaDetail = {
          vod_id: item.vod_id,
          vod_name: item.vod_name,
          vod_pic: item.vod_pic || "",
          vod_remarks: item.vod_remarks || "",
          vod_blurb: item.vod_blurb || "",
          vod_actor: item.vod_actor || "",
          vod_director: item.vod_director || "",
          vod_area: item.vod_area || "",
          vod_year: item.vod_year || "",
          type_name: item.type_name || "",
          episodes: episodes,
          source: source.key,
        };

        return NextResponse.json({
          code: 200,
          msg: "success",
          data: detail,
        });
      } catch (err) {
        if (err instanceof UnsafeOutboundUrlError) {
          errors.push(`${source.name}: ${err.message}`);
          continue;
        }
        const msg = err instanceof Error ? err.message : "未知错误";
        errors.push(`${source.name}: ${msg}`);
        console.warn(`[Shorts Detail] 源 ${source.key} 失败: ${msg}`);
      }
    }

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
    console.error("[Shorts Detail API Error]", error);
    const msg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { code: 500, msg: `获取短剧详情失败：${msg}`, data: null },
      { status: 500 }
    );
  }
}
