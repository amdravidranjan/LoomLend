import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in LoomLend depends on the signed-in user, so we render per request
  // instead of using Cache Components.
  serverExternalPackages: ["@libsql/client"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" }, // condition photos
  },
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
