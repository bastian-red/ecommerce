/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output exists for the Docker image, which copies .next/standalone
  // and runs server.js. Vercel produces its own output format and does not want
  // it, so it is left off there.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  reactStrictMode: true,
  transpilePackages: ['@shop/shared'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
