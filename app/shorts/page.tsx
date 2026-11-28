"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ShortDramaSwiper,
  type ShortDrama,
  type Episode,
} from "@/components/shorts/ShortDramaSwiper";

interface Source {
  key: string;
  name: string;
}

export default function ShortsPage() {
  const [dramas, setDramas] = useState<ShortDrama[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // 多源支持
  const [sources, setSources] = useState<Source[]>([]);
  const [currentSource, setCurrentSource] = useState("wwzy");

  // 从封面页跳转过来时，记录要定位的剧（只用一次）
  const targetRef = useRef<{ vodId: string } | null>(null);

  // 获取短剧详情（获取集数信息）
  const fetchDramaDetail = async (
    vodId: number,
    source: string
  ): Promise<Episode[]> => {
    try {
      const response = await fetch(
        `/api/shorts/detail?ids=${vodId}&source=${source}`
      );
      const result = await response.json();

      if (result.code === 200 && result.data) {
        return result.data.episodes || [];
      }
      return [];
    } catch {
      return [];
    }
  };

  // 获取短剧列表
  const fetchDramas = useCallback(
    async (pageNum: number, source: string, append = false) => {
      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
          setDramas([]); // 切换源时清空
        }

        const response = await fetch(
          `/api/shorts/list?pg=${pageNum}&source=${source}`
        );
        const result = await response.json();

        if (result.code !== 200 || !result.data) {
          // 透传后端给出的真实原因，便于定位是超时还是源站问题
          throw new Error(result.msg || "获取短剧列表失败");
        }

        const dramaList = result.data.list;

        // 保存可用源列表
        if (result.data.sources) {
          setSources(result.data.sources);
        }

        // 关键：用列表接口实际命中的源去取详情，避免列表切换到备用源后
        // 详情仍请求已失效的原源，导致所有短剧被过滤为空
        const activeSource = result.data.source || source;

        // 并行获取每个短剧的详情
        const dramasWithEpisodes = await Promise.all(
          dramaList.map(async (drama: any) => {
            const episodes = await fetchDramaDetail(drama.vod_id, activeSource);
            return {
              vod_id: drama.vod_id,
              vod_name: drama.vod_name,
              vod_pic: drama.vod_pic,
              vod_remarks: drama.vod_remarks,
              episodes:
                episodes.length > 0
                  ? episodes
                  : [{ name: drama.vod_remarks || "正片", url: "" }],
            } as ShortDrama;
          })
        );

        // 保留有名称的短剧：即便详情接口暂时失败也能显示封面
        let validDramas = dramasWithEpisodes.filter(
          (d) => d.vod_name && d.vod_name.trim() !== ""
        );

        // 如果从封面页指定了某部剧，把它放到第一位（这样进来就是这部剧）
        const target = targetRef.current;
        if (!append && target && target.vodId) {
          const idx = validDramas.findIndex(
            (d) => String(d.vod_id) === target.vodId
          );
          if (idx > 0) {
            const picked = validDramas.splice(idx, 1)[0];
            validDramas = [picked, ...validDramas];
          } else if (idx === -1) {
            // 该剧不在当前页，单独取它的详情，插到最前面
            try {
              const detailRes = await fetch(
                `/api/shorts/detail?ids=${target.vodId}&source=${activeSource}`
              );
              const detailJson = await detailRes.json();
              if (detailJson.code === 200 && detailJson.data) {
                const d = detailJson.data;
                const picked: ShortDrama = {
                  vod_id: d.vod_id,
                  vod_name: d.vod_name,
                  vod_pic: d.vod_pic,
                  vod_remarks: d.vod_remarks,
                  episodes:
                    d.episodes && d.episodes.length > 0
                      ? d.episodes
                      : [{ name: d.vod_remarks || "正片", url: "" }],
                };
                validDramas = [picked, ...validDramas];
              }
            } catch {
              // 单独取详情失败则退回默认列表
            }
          }
          targetRef.current = null; // 定位只执行一次
        }

        if (append) {
          setDramas((prev) => [...prev, ...validDramas]);
        } else {
          setDramas(validDramas);
        }

        setHasMore(pageNum < result.data.pagecount);
        setError(null);
      } catch (err) {
        console.error("[Shorts Fetch Error]", err);
        if (!append) {
          const msg = err instanceof Error ? err.message : "加载失败";
          setError(msg);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  // 初始加载：读取封面页带来的 URL 参数（vod_id / source）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vodId = params.get("vod_id");
    const source = params.get("source") || "wwzy";
    if (vodId) targetRef.current = { vodId };
    setCurrentSource(source);
    fetchDramas(1, source, false);
  }, [fetchDramas]);

  // 加载更多
  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchDramas(nextPage, currentSource, true);
    }
  }, [loadingMore, hasMore, page, currentSource, fetchDramas]);

  // 切换源
  const handleSourceChange = useCallback(
    (newSource: string) => {
      if (newSource !== currentSource) {
        targetRef.current = null; // 手动切源后不再定位
        setCurrentSource(newSource);
        setPage(1);
        setDramas([]);
        setHasMore(true);
        fetchDramas(1, newSource, false);
      }
    },
    [currentSource, fetchDramas]
  );

  // 加载状态
  if (loading) {
    return (
      <div className="h-[100dvh] w-full bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/70">加载中...</p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="h-[100dvh] w-full bg-black flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-white text-lg mb-2">{error}</p>
          <p className="text-gray-400 text-xs mb-4">（以上为真实错误原因）</p>
          <button
            onClick={() => fetchDramas(1, currentSource)}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // 空状态
  if (dramas.length === 0) {
    return (
      <div className="h-[100dvh] w-full bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/70 text-lg">暂无短剧内容</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full bg-black overflow-hidden">
      <ShortDramaSwiper
        dramas={dramas}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
        sources={sources}
        currentSource={currentSource}
        onSourceChange={handleSourceChange}
      />
    </div>
  );
}
