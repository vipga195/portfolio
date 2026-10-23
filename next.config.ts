import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Default locale is served without prefix: "/" renders "/en", "/en" redirects to "/"
  async redirects() {
    return [
      { source: "/en", destination: "/", permanent: true },
      { source: "/en/:path+", destination: "/:path+", permanent: true },
    ];
  },
  async rewrites() {
  return {
    afterFiles: [{ source: "/", destination: "/en" }],
    // Any path without a locale prefix falls back to the default locale
    fallback: [{ source: "/:path+", destination: "/en/:path+" }],
  };
},
};

export default nextConfig;
