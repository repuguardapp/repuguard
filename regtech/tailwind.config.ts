import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Hiragino Sans',
          'Noto Sans JP',
          'Noto Sans',
          'sans-serif'
        ]
      },
      colors: {
        brand: {
          50: '#eef5ff',
          500: '#1f6feb',
          900: '#0b2545'
        }
      }
    }
  },
  plugins: []
};

export default config;
