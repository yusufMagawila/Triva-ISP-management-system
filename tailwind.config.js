/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f6ff',
          100: '#dceeff',
          200: '#b3d6ff',
          300: '#80b9ff',
          400: '#4d97ff',
          500: '#1a74ef',
          600: '#0071e3',
          700: '#005cb8',
          800: '#00478d',
          900: '#003268',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tight: '-0.022em',
      },
    },
  },
  plugins: [],
};
