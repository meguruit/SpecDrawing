/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Konva pulls in `canvas` (a node-side optional dep) via its Node entry point even
    // when we only use it client-side. Since the canvas package is unused at runtime here,
    // mark it external so webpack doesn't try to bundle it into the server build.
    config.externals = [...(config.externals || []), { canvas: "commonjs canvas" }];
    return config;
  },
};

export default nextConfig;
