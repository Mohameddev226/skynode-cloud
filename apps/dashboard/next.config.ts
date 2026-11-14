import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
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
};

export default nextConfig;
