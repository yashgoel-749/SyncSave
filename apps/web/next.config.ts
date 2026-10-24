import path from "path";

const nextConfig: NextConfig = {
  reactCompiler: true,
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/**": [
      "../../packages/db/generated/**/*",
      "./packages/db/generated/**/*",
    ],
  },
  serverExternalPackages: ["@syncspace/db", "@prisma/client", "prisma"],
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
