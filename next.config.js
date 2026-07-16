/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true, // TypeScript errors ko ignore karne ke liye
  },
  eslint: {
    ignoreDuringBuilds: true, // ESLint errors ko ignore karne ke liye
  },
};

module.exports = nextConfig;
