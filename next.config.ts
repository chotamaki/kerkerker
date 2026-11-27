import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 上必须禁用 standalone：
  // Next.js 16.3.x + Vercel 注入的构建适配器会跳过 next-server.js.nft.json 的生成，
  // 而 standalone 收尾步骤会强制读取它，导致 ENOENT 构建失败（vercel/next.js#96646）。
  // Vercel 构建时会自动设置 VERCEL=1，此时 output 为 undefined；
  // 本地 Docker / 自托管构建（VERCEL 未设置）仍然保留 standalone，不影响原来的 Dockerfile。
  output: process.env.VERCEL ? undefined : 'standalone',

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
    unoptimized: true,
  },
};

export default nextConfig;
