/** @type {import('next').NextConfig} */
const nextConfig = {
  // Edge runtime for API routes (lower latency, WebSocket support)
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'microphone=*, camera=()',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
