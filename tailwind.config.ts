import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0b',
        panel: '#141417',
        border: '#26262c',
        text: '#e5e5e7',
        muted: '#8a8a92',
        accent: '#7c5cff',
        high: '#ef4444',
        medium: '#f59e0b',
        low: '#10b981',
      },
    },
  },
  plugins: [],
};
export default config;
