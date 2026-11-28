"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface DramaItem {
  vod_id: number;
  vod_name: string;
  vod_pic: string;
  vod_remarks: string;
  type_name?: string;
  source?: string;
}

interface HistoryItem {
  vod_id: number;
  vod_name: string;
  vod_pic: string;
  vod_remarks: string;
  source: string;
  timestamp: number;
}

const HISTORY_KEY = "shorts_play_history_v1";
const MAX_HISTORY = 80;

function PlayIcon() {
  return (
    <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function DramaCard({
  item,
  onOpen,
}: {
  item: DramaItem;
  onOpen: (item: DramaItem) => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      onClick={() => onOpen(item)}
      className="group relative cursor-pointer transition-transform duration-300 hover:scale-[1.03]"
    >
      <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-zinc-800">
        {!imgError && item.vod_pic ? (
          <img
            src={item.vod_pic}
            alt={item.vod_name}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-opacity duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-2 text-center text-sm text-gray-400">
            {item.vod_name}
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p className="text-white text-sm font-medium line-clamp-2 leading-snug">
            {item.vod_name}
          </p>
          {item.vod_remarks ? (
            <p className="text-gray-300 text-xs mt-1">{item.vod_remarks}</p>
          ) : null}
        </div>

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="w-12 h-12 rounded-full bg-red-600/90 flex items-center justify-center shadow-lg shadow-red-900/40">
            <PlayIcon />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number) {
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function ShortsHomePage() {
  const router = useRouter();

  const [tab, setTab] = useState<"featured" | "search" | "history">("featured");
  const [dramas, setDramas] = useState<DramaItem[]>([]);
  const [page, setPage] = useState(1);
  const [pagecount, setPagecount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // 加载精选列表
  const loadList = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shorts/list?pg=${p}`);
      const json = await res.json();
      if (json.code !== 200 || !json.data) {
        throw new Error(json.msg || "加载失败");
      }
      const src: string = json.data.source || "";
      const list: DramaItem[] = (json.data.list || []).map((d: any) => ({
        vod_id: d.vod_id,
        vod_name: d.vod_name,
        vod_pic: d.vod_pic || "",
        vod_remarks: d.vod_remarks || "",
        type_name: d.type_name || "",
        source: src,
      }));
      setDramas((prev) => (append ? [...prev, ...list] : list));
      setPage(p);
      setPagecount(json.data.pagecount || 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList(1, false);
  }, [loadList]);

  // 搜索
  const doSearch = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setTab("search");
    setLoading(true);
    setError(null);
    setDramas([]);
    try {
      const res = await fetch(`/api/shorts/search?wd=${encodeURIComponent(kw)}`);
      const json = await res.json();
      if (json.code !== 200 || !json.data) {
        throw new Error(json.msg || "搜索失败");
      }
      const src: string = json.data.source || "";
      const list: DramaItem[] = (json.data.list || []).map((d: any) => ({
        vod_id: d.vod_id,
        vod_name: d.vod_name,
        vod_pic: d.vod_pic || "",
        vod_remarks: d.vod_remarks || "",
        type_name: d.type_name || "",
        source: src,
      }));
      setDramas(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  };

  // 读取观看历史
  const loadHistory = useCallback(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr: HistoryItem[] = raw ? JSON.parse(raw) : [];
      arr.sort((a, b) => b.timestamp - a.timestamp);
      setHistory(arr);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  // 写入观看历史（点开即记录）
  const pushHistory = (item: DramaItem) => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      let arr: HistoryItem[] = raw ? JSON.parse(raw) : [];
      arr = arr.filter(
        (h) => !(h.vod_id === item.vod_id && h.source === item.source)
      );
      arr.unshift({
        vod_id: item.vod_id,
        vod_name: item.vod_name,
        vod_pic: item.vod_pic || "",
        vod_remarks: item.vod_remarks || "",
        source: item.source || "",
        timestamp: Date.now(),
      });
      arr = arr.slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
    } catch {
      // localStorage 不可用则静默跳过
    }
  };

  // 打开短剧：跳到滑动播放页并定位到这部剧
  const openDrama = (item: DramaItem) => {
    pushHistory(item);
    const src = item.source || "";
    router.push(
      `/shorts?vod_id=${item.vod_id}${src ? `&source=${encodeURIComponent(src)}` : ""}&episode=0`
    );
  };

  const clearHistory = () => {
    try {
      localStorage.removeItem(HISTORY_KEY);
      setHistory([]);
    } catch {
      // 静默
    }
  };

  const removeHistoryItem = (h: HistoryItem) => {
    try {
      const arr = history.filter(
        (x) => !(x.vod_id === h.vod_id && x.source === h.source)
      );
      localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
      setHistory(arr);
    } catch {
      // 静默
    }
  };

  const displayList =
    tab === "history"
      ? history.map((h) => ({
          vod_id: h.vod_id,
          vod_name: h.vod_name,
          vod_pic: h.vod_pic,
          vod_remarks: formatTime(h.timestamp),
          source: h.source,
        }))
      : dramas;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* 顶部 */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-[2000px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors shrink-0"
              aria-label="返回"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold tracking-tight shrink-0">
              <span className="text-red-600">壳儿</span>
              <span className="text-white ml-1">短剧</span>
            </h1>

            {/* 搜索框 */}
            <div className="flex-1 max-w-xl mx-auto">
              <div className="relative">
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  placeholder="搜索短剧名…"
                  className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-4 pr-20 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all"
                />
                <button
                  onClick={doSearch}
                  className="absolute inset-y-0 right-1 my-1 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-full transition-colors"
                >
                  搜索
                </button>
              </div>
            </div>

            <button
              onClick={() => router.push("/shorts")}
              className="hidden sm:block px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm text-gray-300 hover:text-white transition-colors shrink-0"
            >
              刷剧模式
            </button>
          </div>

          {/* Tab */}
          <div className="flex items-center gap-6 mt-4">
            {(
              [
                ["featured", "精选"],
                ["search", "搜索结果"],
                ["history", "观看历史"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`pb-2 text-sm font-medium transition-all border-b-2 ${
                  tab === key
                    ? "text-white border-red-600"
                    : "text-gray-500 border-transparent hover:text-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 内容 */}
      <main className="max-w-[2000px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {tab === "history" && history.length > 0 && (
          <div className="flex justify-end mb-4">
            <button
              onClick={clearHistory}
              className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              清空历史
            </button>
          </div>
        )}

        {error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => loadList(1, false)}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              重试
            </button>
          </div>
        ) : loading && displayList.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-y-8 gap-x-4 animate-pulse">
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="aspect-2/3 bg-zinc-800/50 rounded-lg" />
            ))}
          </div>
        ) : displayList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center mb-5">
              <svg className="w-10 h-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-400 mb-2">
              {tab === "history"
                ? "还没有观看记录，点开一部短剧就会出现在这里"
                : tab === "search"
                  ? "没有找到相关短剧，换个关键词试试"
                  : "暂无短剧内容"}
            </p>
            {tab !== "featured" && (
              <button
                onClick={() => setTab("featured")}
                className="mt-2 px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                去看精选
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-y-8 gap-x-4">
              {displayList.map((item, idx) => (
                <div key={`${item.vod_id}-${idx}`} className="relative group/card">
                  <DramaCard item={item} onOpen={openDrama} />
                  {tab === "history" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const h = history.find(
                          (x) => x.vod_id === item.vod_id && x.source === item.source
                        );
                        if (h) removeHistoryItem(h);
                      }}
                      className="absolute top-2 right-2 z-10 p-1.5 bg-black/60 hover:bg-red-600 rounded-full opacity-0 group-hover/card:opacity-100 transition-all"
                      aria-label="删除记录"
                    >
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {tab === "featured" && page < pagecount && (
              <div className="flex justify-center mt-10">
                <button
                  onClick={() => loadList(page + 1, true)}
                  disabled={loading}
                  className="px-8 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 rounded-full text-sm text-gray-300 hover:text-white transition-colors"
                >
                  {loading ? "加载中…" : "加载更多"}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
