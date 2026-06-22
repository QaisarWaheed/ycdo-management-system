import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1e2a78',
          dark: '#161f5e',
          light: '#2d3a9e',
          foreground: '#ffffff',
        },
        accent: {
          DEFAULT: '#2ecc71',
          dark: '#27ae60',
          foreground: '#ffffff',
        },
        background: '#ffffff',
        surface: '#f8f9fc',
        border: '#e5e7eb',
        text: {
          primary: '#1a1a2e',
          secondary: '#6b7280',
        },
        input: '#e5e7eb',
        ring: '#1e2a78',
        foreground: '#1a1a2e',
        muted: {
          DEFAULT: '#f8f9fc',
          foreground: '#6b7280',
        },
        destructive: {
          DEFAULT: '#ef4444',
          foreground: '#ffffff',
        },
        card: {
          DEFAULT: '#ffffff',
          foreground: '#1a1a2e',
        },
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
