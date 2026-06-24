/** @type {import('tailwindcss').Config} */

// ─────────────────────────────────────────────────────────────────────────────
// Saima's Vintage — "Heritage Atelier" premium design system.
//
// A warm-editorial luxury palette: espresso ink + warm ivory paper + a brass /
// antique-gold accent, tuned to feel like a high-end heritage-craft house
// (Lippan mirror art, Mughal Jharoka decor). Black-ink CTAs on ivory with gold
// filigree — the luxury-house language, kept warm and tactile.
//
// IMPORTANT: every semantic token NAME below is preserved from the previous
// "Heritage Red" export, so existing class names (bg-primary, text-on-surface,
// font-display-lg, text-headline-sm, …) re-skin the entire storefront at once.
// Values are what changed. A few additive tokens (accent/gold, extra shadows,
// easings) are layered on top and used in the redesigned templates.
// ─────────────────────────────────────────────────────────────────────────────
const atelier = {
  colors: {
    // ── Brand: espresso ink. `primary` fills CTAs (with on-primary text) and
    //    also reads as the primary text/price/logo colour. A warm near-black.
    primary: '#241c14',
    'on-primary': '#fbf7ef',
    'primary-container': '#19120c', // deep chips (hero pill, sale chip)
    'on-primary-container': '#ecd9b6', // warm gold-tinted light on deep chips
    'primary-fixed': '#efe3cd',
    'on-primary-fixed': '#1a120b',
    'primary-fixed-dim': '#d9c39d',
    'on-primary-fixed-variant': '#5a4a2c', // CTA hover fill (warm bronze)
    'inverse-primary': '#d8b878', // gold — link hover / focus on dark surfaces
    'surface-tint': '#a87c32', // brass accent tint

    // ── Paper & surfaces (warm ivory family). Body sits on `background`; cards
    //    pop on pure white (`surface-container-lowest`).
    background: '#f7f3ea',
    surface: '#f7f3ea',
    'surface-bright': '#ffffff',
    'surface-dim': '#eae0d0',
    'surface-container-lowest': '#ffffff',
    'surface-container-low': '#f1eadd',
    'surface-container': '#ece2d2',
    'surface-container-high': '#e5dac6',
    'surface-container-highest': '#ddd0b9',
    'surface-variant': '#ece2d2',
    'inverse-surface': '#2a221a',
    'inverse-on-surface': '#f4eee1',

    // ── Ink & secondary text (warm).
    'on-surface': '#241c14',
    'on-background': '#241c14',
    'on-surface-variant': '#6b5d49', // secondary text — ~5.3:1 on ivory
    secondary: '#5f5443',
    'on-secondary': '#ffffff',
    'secondary-container': '#eae0cd',
    'on-secondary-container': '#574c3c',
    'secondary-fixed': '#efe6d4',
    'secondary-fixed-dim': '#d4c8b2',
    'on-secondary-fixed': '#221b12',
    'on-secondary-fixed-variant': '#4a4030',

    // ── Borders / hairlines (warm).
    outline: '#c5b69d',
    'outline-variant': '#dccfb9',

    // ── Tertiary: rich espresso for the footer & dark sections.
    tertiary: '#1e1812',
    'on-tertiary': '#f6efe1',
    'tertiary-container': '#2c2318',
    'on-tertiary-container': '#c6b8a1', // warm muted body — ~7:1 on tertiary
    'tertiary-fixed': '#e4dac6',
    'tertiary-fixed-dim': '#c9bca4',
    'on-tertiary-fixed': '#19130d',
    'on-tertiary-fixed-variant': '#4a3f2d',

    // ── Feedback.
    error: '#b0241c',
    'on-error': '#ffffff',
    'error-container': '#f7ddd7',
    'on-error-container': '#5c130e',

    // ── Additive accent scale (new — used in redesigned templates).
    accent: '#a87c32',
    'accent-soft': '#c9a24b',
    'accent-bright': '#d8b878',
    'accent-deep': '#7c5a1e', // ~5.4:1 on ivory — safe for small accent text
    gold: '#a87c32',
  },
  borderRadius: {
    DEFAULT: '0.25rem',
    sm: '0.25rem',
    lg: '0.5rem',
    xl: '0.875rem',
    '2xl': '1.25rem',
    '3xl': '1.75rem',
    full: '9999px',
  },
  spacing: {
    'margin-mobile': '20px',
    'margin-desktop': '64px',
    unit: '8px',
    'container-max': '1280px',
    gutter: '24px',
  },
  boxShadow: {
    // Soft, neutral, layered lifts — replace the old red-tinted shadow.
    luxe: '0 1px 2px rgba(36, 28, 20, 0.04), 0 12px 28px -16px rgba(36, 28, 20, 0.18)',
    'luxe-lg':
      '0 2px 6px rgba(36, 28, 20, 0.05), 0 30px 60px -28px rgba(36, 28, 20, 0.28)',
    'luxe-xl':
      '0 4px 10px rgba(36, 28, 20, 0.06), 0 50px 90px -40px rgba(36, 28, 20, 0.34)',
  },
  letterSpacing: {
    luxe: '0.2em',
    'luxe-wide': '0.32em',
  },
  transitionTimingFunction: {
    lux: 'cubic-bezier(0.22, 1, 0.36, 1)',
    'lux-in': 'cubic-bezier(0.64, 0, 0.78, 0)',
  },
};

const SERIF = ['"Libre Caslon Text"', 'Georgia', 'Cambria', 'Times New Roman', 'serif'];
const SANS = [
  '"Inter"',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'sans-serif',
];

module.exports = {
  content: [
    './views/**/*.njk',
    './src/client/**/*.{ts,js}',
    './src/**/*.controller.ts',
  ],
  theme: {
    extend: {
      colors: atelier.colors,
      borderRadius: atelier.borderRadius,
      spacing: atelier.spacing,
      boxShadow: atelier.boxShadow,
      letterSpacing: atelier.letterSpacing,
      transitionTimingFunction: atelier.transitionTimingFunction,
      maxWidth: { 'container-max': '1280px' },
      fontFamily: {
        sans: SANS,
        serif: SERIF,
        'display-lg': SERIF,
        'display-lg-mobile': SERIF,
        'headline-lg': SERIF,
        'headline-lg-mobile': SERIF,
        'headline-md': SERIF,
        'headline-sm': SERIF,
        'body-lg': SANS,
        'body-md': SANS,
        'label-md': SANS,
        'label-sm': SANS,
      },
      fontSize: {
        // Heritage Atelier type scale — Libre Caslon Text display, Inter UI.
        // Refined tracking/leading for a more editorial, premium feel.
        'label-sm': ['12px', { lineHeight: '16px', letterSpacing: '0.1em', fontWeight: '500' }],
        'label-md': ['14px', { lineHeight: '18px', letterSpacing: '0.12em', fontWeight: '600' }],
        'headline-sm': ['22px', { lineHeight: '30px', letterSpacing: '-0.008em', fontWeight: '400' }],
        'headline-lg-mobile': ['32px', { lineHeight: '1.12', letterSpacing: '-0.012em', fontWeight: '400' }],
        'headline-md': ['30px', { lineHeight: '38px', letterSpacing: '-0.014em', fontWeight: '400' }],
        'display-lg-mobile': ['40px', { lineHeight: '1.04', letterSpacing: '-0.02em', fontWeight: '400' }],
        'display-lg': ['68px', { lineHeight: '1.0', letterSpacing: '-0.032em', fontWeight: '400' }],
        'headline-lg': ['42px', { lineHeight: '1.08', letterSpacing: '-0.02em', fontWeight: '400' }],
        'body-md': ['16px', { lineHeight: '26px', fontWeight: '400' }],
        'body-lg': ['18px', { lineHeight: '30px', fontWeight: '400' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
