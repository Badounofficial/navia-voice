/** @type {import('next').NextConfig} */
const nextConfig = {
  // Edge runtime for API routes (lower latency, WebSocket support)
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
};

module.exports = nextConfig;
