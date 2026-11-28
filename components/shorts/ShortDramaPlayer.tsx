"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type Artplayer from "artplayer";

interface ShortDramaPlayerProps {
  videoUrl: string;
  isActive: boolean;
  onEnded: () => void;
  onProgress?: (progress: number, duration: number) => void;
}

/**
 * 解析播放地址：短剧源（如量子资源 lzzy）返回的 vod_play_url 是分享页链接
 * （例如 https://lzv34.com/share/xxx），而不是 m3u8 直链。
 * 分享页 HTML 里藏着 var main = "/xxx/index.m3u8?sign=..." 这样的真实地址。
 *
 * 原播放器直接把分享页当 m3u8 交给 hls.js → 必然 "视频加载失败"。
 * 本函数在浏览器端（用户国内网络）抓取分享页、提取真实 m3u8 再播放，
 * 不走 Vercel 代理（海外节点访问国内域名会 404）。
 */
async function resolvePlayableUrl(rawUrl: string): Promise<string> {
  if (!rawUrl) return rawUrl;

  // 已经是 m3u8 直链，直接用
  if (/\.m3u8(\?|$)/i.test(rawUrl)) return rawUrl;

  try {
    // 抓取分享页 HTML（源站有 Access-Control-Allow-Origin: *，浏览器可跨域读）
    const response = await fetch(rawUrl, {
      mode: "cors",
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) return rawUrl;

    const html = await response.text();

    // 提取 var main = "..." / var main='...' 里的 m3u8 路径
    const match =
      html.match(/var\s+main\s*=\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
      html.match(/["']([^"']+\.m3u8[^"']*)["']/i);
    if (!match || !match[1]) return rawUrl;

    const m3u8Path = match[1];
    const base = new URL(rawUrl);

    // 绝对路径直接返回；相对路径拼上分享页域名
    if (/^https?:\/\//i.test(m3u8Path)) return m3u8Path;
    return `${base.protocol}//${base.host}${m3u8Path.startsWith("/") ? "" : "/"}${m3u8Path}`;
  } catch {
    // 解析失败（CORS/网络/格式不符），返回原始地址让播放器按原逻辑处理
    return rawUrl;
  }
}

export function ShortDramaPlayer({
  videoUrl,
  isActive,
  onEnded,
  onProgress,
}: ShortDramaPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const hlsRef = useRef<any>(null);
  const isMountedRef = useRef(true);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  // 第一步：先把可能是分享页的地址解析成真实 m3u8
  useEffect(() => {
    let cancelled = false;
    setResolvedUrl(null);
    resolvePlayableUrl(videoUrl).then((url) => {
      if (!cancelled) setResolvedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  // 第二步：用解析后的地址初始化播放器
  useEffect(() => {
    if (!containerRef.current || !resolvedUrl) return;

    isMountedRef.current = true;
    setIsLoading(true);
    setError(null);

    const initPlayer = async () => {
      try {
        const [ArtplayerModule, HlsModule] = await Promise.all([
          import("artplayer"),
          import("hls.js"),
        ]);

        if (!isMountedRef.current || !containerRef.current) return;

        const Artplayer = ArtplayerModule.default;
        const Hls = HlsModule.default;

        // 清理旧实例
        if (artRef.current) {
          artRef.current.destroy();
          artRef.current = null;
        }
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const art = new Artplayer({
          container: containerRef.current,
          url: resolvedUrl,
          type: "m3u8",
          volume: 0.8,
          muted: false,
          autoplay: false,
          pip: false,
          fullscreen: true,
          fullscreenWeb: false,
          screenshot: false,
          setting: true,
          playbackRate: true,
          aspectRatio: false,
          loop: false,
          mutex: true,
          backdrop: true,
          playsInline: true,
          theme: "#e50914", // Netflix红色
          lang: "zh-cn",
          lock: false,
          fastForward: true,
          autoOrientation: true,
          miniProgressBar: true,
          moreVideoAttr: {
            crossOrigin: "anonymous",
          },
          settings: [
            {
              name: "playbackRate",
              html: "倍速播放",
              selector: [
                { html: "0.5x", value: 0.5 },
                { html: "0.75x", value: 0.75 },
                { html: "1x 正常", value: 1, default: true },
                { html: "1.25x", value: 1.25 },
                { html: "1.5x", value: 1.5 },
                { html: "2x", value: 2 },
                { html: "3x", value: 3 },
              ],
              onSelect: function (item) {
                if (art && "value" in item && typeof item.value === "number") {
                  art.playbackRate = item.value;
                }
                return item.html;
              },
            },
          ],
          customType: {
            m3u8: (video: HTMLVideoElement, url: string) => {
              if (!isMountedRef.current) return;

              if (Hls.isSupported()) {
                const hls = new Hls({
                  enableWorker: true,
                  lowLatencyMode: false,
                  maxBufferLength: 30,
                  maxMaxBufferLength: 60,
                });
                hlsRef.current = hls;

                hls.loadSource(url);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                  setIsLoading(false);
                });

                hls.on(Hls.Events.ERROR, (_: string, data: any) => {
                  if (data.fatal) {
                    setError("视频加载失败");
                    setIsLoading(false);
                  }
                });
              } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = url;
                setIsLoading(false);
              } else {
                setError("浏览器不支持此视频格式");
                setIsLoading(false);
              }
            },
          },
        });

        artRef.current = art;

        // 监听事件
        art.on("ready", () => {
          setIsLoading(false);
        });

        art.on("video:timeupdate", () => {
          if (onProgress && art.duration > 0) {
            onProgress(art.currentTime, art.duration);
          }
        });

        art.on("video:ended", () => {
          onEnded();
        });

        art.on("video:error", () => {
          setError("视频播放失败");
        });
      } catch (err) {
        console.error("[ShortDramaPlayer Init Error]", err);
        setError("播放器初始化失败");
        setIsLoading(false);
      }
    };

    initPlayer();

    return () => {
      isMountedRef.current = false;
      if (artRef.current) {
        artRef.current.destroy();
        artRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [resolvedUrl]);

  // 控制播放/暂停
  useEffect(() => {
    const art = artRef.current;
    if (!art) return;

    if (isActive && !isLoading) {
      // 先尝试有声音播放
      art.muted = false;
      art.play().catch(() => {
        // 浏览器阻止自动播放，改为静音播放
        art.muted = true;
        art.play().catch(() => {
          // 静音也失败，用户需要手动点击播放
        });
      });
    } else if (!isActive && art.playing) {
      art.pause();
    }
  }, [isActive, isLoading]);

  // 重试
  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    if (artRef.current) {
      artRef.current.destroy();
      artRef.current = null;
    }
    setResolvedUrl(null);
    // 重新触发解析（用微任务确保状态已更新）
    resolvePlayableUrl(videoUrl).then((url) => setResolvedUrl(url));
  }, [videoUrl]);

  return (
    <div className="relative w-full h-full bg-black">
      {/* Artplayer 容器 - z-index 低于 overlay */}
      <div
        ref={containerRef}
        className="w-full h-full z-10 [&_.art-video-player]:!h-full [&_.art-video]:object-contain"
        style={{ height: "100%" }}
      />

      {/* 加载状态 */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none z-20">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-30">
          <div className="text-center">
            <div className="text-red-500 text-lg mb-2">{error}</div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRetry();
              }}
              className="px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
