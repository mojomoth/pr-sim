import type { NextConfig } from "next";

// PoC host for PR-SIM. cacheComponents is intentionally OFF to keep PoC
// route handlers / fs reads simple. Each PoC lives in pocs/<name>/ and is
// mounted at /<name> via thin route files in app/<name>/.
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "unpdf", "puppeteer-core"],
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
