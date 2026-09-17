import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Default locale is served without prefix: "/" renders "/en", "/en" redirects to "/"
  async redirects() {
    return [{ source: "/en", destination: "/", permanent: true }];
  },
  async rewrites() {
    return [{ source: "/", destination: "/en" }];
  },
};

export default nextConfig;
