/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@shop/shared'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
