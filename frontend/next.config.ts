import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next leaves the AWS SDK out of the server bundle by default and loads it
  // at runtime through a symlink under .next/node_modules. Amplify's deployed
  // .next has no working link, so every route that touches R2 storage failed
  // to load (a bare 500). Bundling the SDK removes the runtime lookup.
  transpilePackages: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
};

export default nextConfig;
