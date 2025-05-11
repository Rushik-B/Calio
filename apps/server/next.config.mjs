import path from 'path';
import { fileURLToPath } from 'url';

// Helper to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // It's good practice to ensure the alias object exists.
    config.resolve.alias = config.resolve.alias || {};

    // Add aliases to force resolution to the project root's node_modules
    config.resolve.alias['react'] = path.resolve(__dirname, '../../node_modules/react');
    config.resolve.alias['react-dom'] = path.resolve(__dirname, '../../node_modules/react-dom');

    return config;
  },
  experimental: {
    esmExternals: false,
  },
};

export default nextConfig;
