/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    domains: ['images.unsplash.com', '76.13.141.221'],
  },
  async rewrites() {
    return [
      {
        source: '/api/site/:path*',
        destination: `${process.env.SITE_API_URL || 'http://lega-backend:8000'}/api/site/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
