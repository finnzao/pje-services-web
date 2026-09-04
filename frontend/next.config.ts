import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy API requests to the backend to avoid CORS issues with EventSource (SSE).
  // In production NEXT_PUBLIC_API_URL must point to the deployed API; in local
  // development it falls back to the backend dev server (default port 10000).
  async rewrites() {
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ||
      (process.env.NODE_ENV !== 'production' ? 'http://localhost:10000' : '');
    if (!apiUrl) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
