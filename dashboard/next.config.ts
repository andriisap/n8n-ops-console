import type { NextConfig } from 'next';

const config: NextConfig = {
  // Self-contained server bundle for a small Docker image.
  output: 'standalone',
  poweredByHeader: false,
};

export default config;
