import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The webview payment page: no caching, no framing, and nothing leaks through Referer.
  async headers() {
    return [
      {
        source: "/pay/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
