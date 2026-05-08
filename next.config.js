const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker/本番向け: standalone出力でイメージサイズを最小化
  output: 'standalone',

  // Force a single yjs instance to prevent "Yjs was already imported" error
  // when both ESM and CJS variants are loaded in the same bundle.
  webpack(config) {
    config.resolve.alias['yjs'] = path.resolve(__dirname, 'node_modules/yjs');
    return config;
  },

  turbopack: {
    resolveAlias: {
      yjs: './node_modules/yjs',
    },
  },

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
