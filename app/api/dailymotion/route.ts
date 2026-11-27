import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby 上限 60 秒
export const revalidate = 0;

interface DailymotionVideo {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  url: string;
  created_time?: string;
}

interface DailymotionChannel {
  name: string;
  handle: string;
  avatar: string;
  videos: DailymotionVideo[];
  hasMore?: boolean;
  total?: number;
  page?: number;
}

interface RestAPIVideo {
  id: string;
  title: string;
  thumbnail_240_url?: string;
  thumbnail_720_url?: string;
  duration?: number;
  created_time?: number;
}

// 公开数据读取接口（api.dailymotion.com）支持免认证访问，
// 原实现失败的根因：无超时 + 字段失效 + GraphQL 兜底用了不存在的 OAuth 端点必失败。
// 本实现只保留可靠的 REST 路径，并把真实错误透传给前端。

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get('username') || 'kchow125';
  const page = parseInt(searchParams.get('page') || '1', 10);

  if (!username || username.trim() === '') {
    return NextResponse.json(
      { error: '未提供频道用户名（username）' },
      { status: 400 }
    );
  }

  try {
    const channelData = await fetchChannelDataFromRestAPI(username, page);
    return NextResponse.json(channelData);
  } catch (error) {
    console.error('[Dailymotion] 获取失败:', error);
    const message = error instanceof Error ? error.message : '获取频道数据失败';
    // 把真实原因透传给前端，不再笼统报 Failed to fetch channel data
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

async function fetchChannelDataFromRestAPI(
  channelName: string,
  page: number = 1
): Promise<DailymotionChannel> {
  const limit = 30;
  const timeout = 20000;

  // 先按 username（频道 handle）查询；失败则按 user id 查询
  const userEndpoints = [
    `https://api.dailymotion.com/user/${encodeURIComponent(channelName)}?fields=id,screenname,avatar_240_url`,
  ];

  let userData: any = null;
  let userError = '';

  for (const endpoint of userEndpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(timeout),
        cache: 'no-store',
      });
      if (!response.ok) {
        userError = `查询频道信息返回 HTTP ${response.status}`;
        continue;
      }
      const json = await response.json();
      if (json?.error) {
        userError = json.error.message || '查询频道信息失败';
        continue;
      }
      if (json?.id) {
        userData = json;
        break;
        }
    } catch (err) {
      userError = err instanceof Error ? err.message : '查询频道信息网络错误';
    }
  }

  if (!userData) {
    throw new Error(
      `找不到频道「${channelName}」${userError ? `：${userError}` : ''}。请在后台「DailyMotion 设置」中确认频道名是否正确。`
    );
  }

  const userId = userData.id;

  const videosResponse = await fetch(
    `https://api.dailymotion.com/user/${encodeURIComponent(userId)}/videos?fields=id,title,thumbnail_240_url,thumbnail_720_url,duration,created_time&limit=${limit}&page=${page}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(timeout),
      cache: 'no-store',
    }
  );

  if (!videosResponse.ok) {
    throw new Error(`获取视频列表返回 HTTP ${videosResponse.status}`);
  }

  const videosData = await videosResponse.json();
  if (videosData?.error) {
    throw new Error(videosData.error.message || '获取视频列表失败');
  }

  const rawList: RestAPIVideo[] = Array.isArray(videosData?.list) ? videosData.list : [];

  const videos: DailymotionVideo[] = rawList.map((video) => ({
    id: video.id,
    title: video.title,
    // 优先用 720 图，退化到 240；避免 thumbnail_240_url 字段失效导致空图
    thumbnail: video.thumbnail_720_url || video.thumbnail_240_url || '',
    duration: formatDuration(video.duration || 0),
    url: `https://www.dailymotion.com/video/${video.id}`,
    created_time: String(video.created_time || ''),
  }));

  return {
    name: userData.screenname || channelName,
    handle: `@${channelName}`,
    avatar: userData.avatar_240_url || '',
    videos,
    hasMore: Boolean(videosData.has_more),
    page: videosData.page || page,
    total: rawList.length,
  };
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
