import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        ims: {
          primary: '#006EC4',
          'primary-hover': '#005A9E',
          sidebar: '#D6E8F8',
          'sidebar-active': '#C1DCF5',
          hero: '#EEF5FC',
          'table-head': '#F4F6F9',
          surface: '#FFFFFF',
          canvas: '#F8FAFC',
        },
      },
      boxShadow: {
        'ims-card': '0 2px 12px rgba(15, 23, 42, 0.04)',
        'ims-modal': '0 20px 50px rgba(15, 23, 42, 0.16)',
      },
    },
  },
  plugins: [],
}
export default config

