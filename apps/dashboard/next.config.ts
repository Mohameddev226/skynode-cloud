import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.NETLIFY ? undefined : 'standalone',
  reactStrictMode: true,
  transpilePackages: [
    '@skynode/config',
    '@skynode/types',
    '@skynode/validation',
  ],
  // typedRoutes disabled until all routes are finalized
  // experimental: {
  //   typedRoutes: true,
  // },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.skynode.cloud',
      },
    ],
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
