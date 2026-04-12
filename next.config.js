/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker/本番向け: standalone出力でイメージサイズを最小化
  output: 'standalone',

  // PWA-related headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' }
        ]
      }
    ];
  },
  allowedDevOrigins: ['100.114.62.43'],
};

module.exports = nextConfig;
