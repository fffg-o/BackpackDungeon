/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@backpack-dungeon/shared",
    "@backpack-dungeon/game-core"
  ]
};

export default nextConfig;
