import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true, // Required for static export
  },
  // Ensure trailing slashes for S3/CloudFront compatibility
  trailingSlash: true,
};

export default nextConfig;
