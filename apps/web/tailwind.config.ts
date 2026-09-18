import type { Config } from 'tailwindcss';

/**
 * Exam-Sync design tokens (FRONTEND_UX_ARCHITECTURE.md §1).
 *
 * Breakpoint mapping (Tailwind defaults kept as-is, not a parallel scale):
 *   sm  (640px)  ~ mobile/tablet boundary   — UX doc's <768px "mobile" starts below `md`
 *   md  (768px)  = UX doc's "tablet" (768–1023px) lower bound
 *   lg  (1024px) = UX doc's "laptop" (1024–1279px) lower bound
 *   xl  (1280px) = UX doc's "desktop" (≥1280px) lower bound
 *   2xl (1536px) unused by the UX doc's own scale, left at Tailwind default for headroom
 *
 * Colors: implemented as Tailwind theme.extend.colors (not CSS custom properties)
 * for `text-*`/`bg-*`/`border-*` utility ergonomics and JIT purging; the few things
 * Tailwind's theme cannot express as utilities (named z-index layers as var() escape
 * hatches for arbitrary contexts, and any raw CSS need) live in styles/tokens.css.
 * Semantic aliases (background/surface/border/text/text-muted) are defined below as
 * named colors on top of the neutral ramp so components reference them by intent
 * (`bg-surface`, `border-default`, `text-muted`) rather than raw neutral-N shades.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.4' }], // 12px
        sm: ['0.8125rem', { lineHeight: '1.4' }], // 13px
        base: ['0.875rem', { lineHeight: '1.4' }], // 14px — default body in a dense ops tool
        md: ['1rem', { lineHeight: '1.4' }], // 16px
        lg: ['1.125rem', { lineHeight: '1.3' }], // 18px
        xl: ['1.25rem', { lineHeight: '1.2' }], // 20px
        '2xl': ['1.5rem', { lineHeight: '1.2' }], // 24px
        '3xl': ['1.875rem', { lineHeight: '1.2' }], // 30px
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
      },
      colors: {
        // Cool, low-chroma neutral ramp (gray-blue undertone, not pure black/white).
        neutral: {
          50: '#f7f8f9',
          100: '#eceef1',
          200: '#dde1e6',
          300: '#c3c9d1',
          400: '#9aa3af',
          500: '#717a87',
          600: '#545c68',
          700: '#3d4350',
          800: '#282c36',
          900: '#181b21',
          950: '#0e1014',
        },
        // Restrained teal-blue accent (not purple/violet).
        primary: {
          50: '#eff8fa',
          100: '#dceff3',
          200: '#b8dfe7',
          300: '#89c8d6',
          400: '#4fa8bc',
          500: '#2e8aa1',
          600: '#256f83',
          700: '#20596a',
          800: '#1d4a58',
          900: '#1a3e4a',
          950: '#0d2731',
        },
        // Five-color semantic status system — each a 3-step ramp: subtle bg / border / solid text-or-icon.
        success: { bg: '#eaf6ee', border: '#a9d9b8', text: '#1e6b3a' },
        warning: { bg: '#fdf3e2', border: '#f0cd8c', text: '#8a5a10' },
        danger: { bg: '#fbeaea', border: '#e8a9a9', text: '#9c2626' },
        info: { bg: '#e9f2fa', border: '#a8cbe8', text: '#1e5a92' },
        statusneutral: { bg: '#f0f1f3', border: '#c9ced5', text: '#4b525c' },
        // Semantic aliases over the neutral ramp.
        background: '#f7f8f9', // neutral-50
        surface: '#ffffff',
        border: {
          DEFAULT: '#dde1e6', // neutral-200 — the one hairline border color used everywhere
          strong: '#c3c9d1', // neutral-300
        },
        text: {
          DEFAULT: '#181b21', // neutral-900
          muted: '#545c68', // neutral-600
          subtle: '#717a87', // neutral-500
        },
      },
      borderRadius: {
        sm: '4px', // chips/badges
        DEFAULT: '6px', // controls
        md: '6px',
        lg: '8px', // cards/modals
      },
      boxShadow: {
        // Resting card shadow: effectively a hairline border + barely-there shadow.
        card: '0 1px 2px rgba(14, 16, 20, 0.04)',
        // Elevated overlays: popovers/dropdowns/modals.
        elevated: '0 4px 16px rgba(14, 16, 20, 0.10)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'ease',
      },
      zIndex: {
        dropdown: '1000',
        sticky: '1100',
        drawer: '1200',
        'modal-backdrop': '1300',
        modal: '1310',
        toast: '1400',
        tooltip: '1500',
      },
    },
  },
  plugins: [],
};

export default config;
