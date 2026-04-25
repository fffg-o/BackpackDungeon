/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Resolve .js imports to .ts files for workspace packages
    // The game-core and shared packages use .js extensions in their source imports
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js", ".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
