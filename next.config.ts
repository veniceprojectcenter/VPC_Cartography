import type { NextConfig } from "next";

// The tiler runs wasm-vips with threads, which needs SharedArrayBuffer, which needs the page and
// its workers to be cross-origin isolated. Only the uploader and the files its worker loads get
// these headers; the viewer stays an ordinary page.
const ISOLATED = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  headers() {
    return [
      { source: "/upload", headers: ISOLATED },
      { source: "/tiler/:path*", headers: ISOLATED },
      { source: "/vendor/:path*", headers: ISOLATED },
    ];
  },
};

export default nextConfig;
