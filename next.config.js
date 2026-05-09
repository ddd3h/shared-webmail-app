const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

// Security headers applied to every route.
// CSP uses 'unsafe-inline' for scripts/styles because Next.js App Router
// requires inline script injection for hydration when nonces are not used.
// 'unsafe-eval' is added in development only — React DevTools and Turbopack
// require eval() for source maps and stack reconstruction; never used in prod.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    // 2-year HSTS — only effective over HTTPS; harmless over HTTP (browsers ignore it)
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // Email HTML bodies may reference external images — keep broad
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://openrouter.ai",
      "worker-src 'self' blob:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker/本番向け: standalone出力でイメージサイズを最小化
  output: 'standalone',

  // Suppress server identity disclosure
  poweredByHeader: false,

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

  async headers() {
    return [
      // Apply security headers to every route
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
      // Service Worker must not be cached and must be allowed at root scope
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  allowedDevOrigins: ['100.114.62.43'],
};

module.exports = nextConfig;
