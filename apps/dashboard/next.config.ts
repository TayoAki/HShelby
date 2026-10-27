import type { NextConfig } from "next";

// The browser only ever talks to this origin. /api/* (including Better Auth's
// /api/auth/*) is proxied to the API service, so session cookies stay first-party.
const apiUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  images: { remotePatterns: [{ protocol: "https", hostname: "**.mzstatic.com" }] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
