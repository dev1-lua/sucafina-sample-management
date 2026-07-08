import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: { lg: 'var(--radius)', md: '6px', sm: '4px' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      // '2xs' formalizes the micro-copy step Twenty uses for things like kbd
      // hints and pill timestamps — smaller than the 11px column-header size.
      fontSize: { '2xs': ['10px', '14px'], xs: ['11px', '16px'], sm: ['13px', '18px'], base: ['13px', '18px'] },
      spacing: { '4.5': '18px' },
      keyframes: {
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        // Agent deep-link landing: pulse the target row so it's unmistakable which
        // record was just created/updated. Two quick primary-tinted pulses that then
        // hold briefly and settle back to transparent — far more noticeable than a
        // single instant fade, while still calming down on its own.
        'row-flash': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '10%, 40%, 70%': { backgroundColor: 'hsl(var(--primary) / 0.22)' },
          '25%, 55%, 85%': { backgroundColor: 'hsl(var(--accent))' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 180ms ease-out',
        'fade-in': 'fade-in 150ms ease-out',
        'row-flash': 'row-flash 2.2s ease-in-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
