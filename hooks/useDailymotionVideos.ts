import useSWR from 'swr';
import { DailymotionChannel } from '@/types/dailymotion';

// 获取 Dailymotion 频道视频
async function fetchChannelVideos(username: string, page: number): Promise<DailymotionChannel> {
  const response = await fetch(`/api/dailymotion?username=${encodeURIComponent(username)}&page=${page}`);

  if (!response.ok) {
    // 透传后端返回的真实错误原因，便于定位频道名/网络问题
    let message = `Failed to fetch channel data (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // 忽略解析失败，保留默认错误信息
    }
    throw new Error(message);
  }

  return response.json();
}

interface UseDailymotionVideosReturn {
  channelData: DailymotionChannel | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * 管理 Dailymotion 频道视频数据
 * 使用 SWR 缓存视频列表
 */
export function useDailymotionVideos(
  username: string | null,
  page: number
): UseDailymotionVideosReturn {
  const { data, error, isLoading, mutate } = useSWR(
    username ? `dailymotion-videos-${username}-${page}` : null,
    () => fetchChannelVideos(username!, page),
    {
      revalidateOnFocus: false,
    }
  );

  return {
    channelData: data || null,
    hasMore: data?.hasMore || false,
    loading: isLoading && !data,
    error: error?.message || null,
    refetch: async () => { await mutate(); },
  };
}
