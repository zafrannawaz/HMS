/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true, // TypeScript errors ko ignore karne ke liye
  },
  eslint: {
    ignoreDuringBuilds: true, // ESLint errors ko ignore karne ke liye
  },
};

module.exports = nextConfig;