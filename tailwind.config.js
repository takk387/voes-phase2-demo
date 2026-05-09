/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d4d8e0',
          300: '#aeb5c2',
          400: '#828c9e',
          500: '#626d80',
          600: '#4d5666',
          700: '#404754',
          800: '#373d47',
          900: '#1f242c'
        },
        accent: {
          50: '#eef4ff',
          100: '#dbe7fe',
          200: '#bfd5fe',
          300: '#93b8fc',
          400: '#6092f8',
          500: '#3b6df3',
          600: '#2552e6',
          700: '#1e40d2',
          800: '#1f37a9',
          900: '#1f3385'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};
