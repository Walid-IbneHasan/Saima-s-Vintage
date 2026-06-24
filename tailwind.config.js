/** @type {import('tailwindcss').Config} */

// Design tokens ported from the updated Stitch "Heritage Red" design system
// (heritage_minimalist_2 / saima_s_vintage_*_heritage_red). Color/spacing/radius/
// type names match the Stitch export so its generated class names (bg-primary,
// font-display-lg, text-headline-sm, …) render identically here.
const heritage = {
  colors: {
    // "Heritage Red" palette from the updated Stitch export
    // (heritage_minimalist_2 / saima_s_vintage_*_heritage_red). Deep heritage red
    // + obsidian + museum near-white surfaces. NOTE: `primary` (#8b0000, the bright
    // action red) and `primary-container` (#610000, the deep brand red) are swapped
    // vs the raw export so existing `bg-primary`/`text-primary` CTAs render in the
    // vibrant action red without per-template edits.
    'on-tertiary': '#ffffff',
    primary: '#8b0000',
    'surface-tint': '#b52619',
    background: '#fbf9f9',
    'surface-container-highest': '#e3e2e2',
    'primary-fixed-dim': '#ffb4a8',
    'inverse-surface': '#303031',
    'primary-container': '#610000',
    'surface-bright': '#fbf9f9',
    'inverse-on-surface': '#f2f0f0',
    tertiary: '#2b2d2c',
    'on-secondary-fixed': '#1c1b1b',
    'on-error': '#ffffff',
    'tertiary-container': '#414342',
    'on-tertiary-fixed': '#1a1c1b',
    outline: '#8e706b',
    'error-container': '#ffdad6',
    error: '#ba1a1a',
    'on-tertiary-container': '#afafae',
    secondary: '#5f5e5e',
    'on-primary-fixed': '#410000',
    'on-primary-container': '#ff907f',
    'secondary-fixed': '#e5e2e1',
    'on-secondary-fixed-variant': '#474746',
    surface: '#fbf9f9',
    'on-surface': '#1b1c1c',
    'on-error-container': '#93000a',
    'primary-fixed': '#ffdad4',
    'surface-container-high': '#e9e8e7',
    'surface-container-lowest': '#ffffff',
    'on-secondary': '#ffffff',
    'surface-container': '#efeded',
    'tertiary-fixed': '#e2e3e1',
    'on-surface-variant': '#5a403c',
    'secondary-fixed-dim': '#c8c6c5',
    'on-secondary-container': '#636262',
    'surface-dim': '#dbdad9',
    'on-primary': '#ffffff',
    'outline-variant': '#e3beb8',
    'inverse-primary': '#ffb4a8',
    'on-tertiary-fixed-variant': '#454746',
    'on-primary-fixed-variant': '#920703',
    'surface-variant': '#e3e2e2',
    'surface-container-low': '#f5f3f3',
    'tertiary-fixed-dim': '#c6c7c5',
    'on-background': '#1b1c1c',
    'secondary-container': '#e2dfde',
  },
  borderRadius: {
    DEFAULT: '0.25rem',
    lg: '0.5rem',
    xl: '0.75rem',
    full: '9999px',
  },
  spacing: {
    'margin-mobile': '20px',
    'margin-desktop': '64px',
    unit: '8px',
    'container-max': '1280px',
    gutter: '24px',
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
      colors: heritage.colors,
      borderRadius: heritage.borderRadius,
      spacing: heritage.spacing,
      maxWidth: { 'container-max': '1280px' },
      fontFamily: {
        // Site-wide defaults adopt the Heritage type pairing.
        sans: SANS,
        serif: SERIF,
        // Named families from the Stitch design (used as font-display-lg etc.).
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
        // Heritage Red type scale (Libre Caslon Text display, Inter body/labels).
        'label-sm': ['12px', { lineHeight: '16px', letterSpacing: '0.03em', fontWeight: '500' }],
        'label-md': [
          '14px',
          { lineHeight: '20px', letterSpacing: '0.05em', fontWeight: '600' },
        ],
        'headline-sm': ['24px', { lineHeight: '32px', fontWeight: '400' }],
        'headline-lg-mobile': ['32px', { lineHeight: '1.2', fontWeight: '400' }],
        'headline-md': ['32px', { lineHeight: '40px', fontWeight: '400' }],
        'display-lg-mobile': [
          '40px',
          { lineHeight: '48px', letterSpacing: '-0.01em', fontWeight: '400' },
        ],
        'display-lg': [
          '64px',
          { lineHeight: '72px', letterSpacing: '-0.02em', fontWeight: '400' },
        ],
        'headline-lg': ['40px', { lineHeight: '1.2', fontWeight: '400' }],
        'body-md': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
