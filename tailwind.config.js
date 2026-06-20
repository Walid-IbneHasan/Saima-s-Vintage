/** @type {import('tailwindcss').Config} */

// Design tokens ported from the Stitch "Heritage Minimalist" design system
// (heritage_minimalist/DESIGN.md). Color/spacing/radius/type names match the
// Stitch export so its generated class names (bg-primary, font-display-lg,
// text-headline-lg, …) render identically here.
const heritage = {
  colors: {
    'on-secondary-fixed-variant': '#574500',
    'on-tertiary-fixed-variant': '#4f4538',
    'surface-tint': '#944925',
    tertiary: '#584e40',
    'on-surface': '#1b1c1c',
    'primary-fixed': '#ffdbcd',
    'surface-container-highest': '#e4e2e1',
    'on-tertiary': '#ffffff',
    'on-primary-container': '#ffe1d6',
    'on-error-container': '#93000a',
    'surface-container-lowest': '#ffffff',
    'on-error': '#ffffff',
    'inverse-surface': '#303030',
    error: '#ba1a1a',
    'on-primary-fixed': '#360f00',
    'on-primary': '#ffffff',
    'tertiary-fixed': '#efe0cd',
    'primary-fixed-dim': '#ffb596',
    primary: '#823b18',
    surface: '#fcf9f8',
    'surface-container': '#f0eded',
    'surface-container-high': '#eae7e7',
    'surface-container-low': '#f6f3f2',
    'outline-variant': '#dac1b8',
    'on-surface-variant': '#54433c',
    'secondary-fixed': '#ffe088',
    'secondary-fixed-dim': '#e9c349',
    background: '#fcf9f8',
    'on-secondary': '#ffffff',
    'tertiary-container': '#716657',
    'on-background': '#1b1c1c',
    'surface-dim': '#dcd9d9',
    'inverse-primary': '#ffb596',
    'surface-bright': '#fcf9f8',
    'on-tertiary-container': '#f4e5d2',
    'primary-container': '#a0522d',
    'secondary-container': '#fed65b',
    'on-primary-fixed-variant': '#76320f',
    'error-container': '#ffdad6',
    'tertiary-fixed-dim': '#d2c4b2',
    'on-secondary-container': '#745c00',
    secondary: '#735c00',
    'inverse-on-surface': '#f3f0f0',
    outline: '#87736b',
    'on-secondary-fixed': '#241a00',
    'surface-variant': '#e4e2e1',
    'on-tertiary-fixed': '#221a0f',
  },
  borderRadius: {
    DEFAULT: '1rem',
    lg: '2rem',
    xl: '3rem',
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

const SERIF = ['"Bodoni Moda"', 'Georgia', 'Cambria', 'Times New Roman', 'serif'];
const SANS = [
  '"Hanken Grotesk"',
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
        'headline-lg': SERIF,
        'headline-lg-mobile': SERIF,
        'headline-md': SERIF,
        'body-lg': SANS,
        'body-md': SANS,
        'label-md': SANS,
        'label-sm': SANS,
      },
      fontSize: {
        'label-sm': ['12px', { lineHeight: '1.2', fontWeight: '500' }],
        'label-md': [
          '14px',
          { lineHeight: '1.2', letterSpacing: '0.05em', fontWeight: '600' },
        ],
        'headline-lg-mobile': ['32px', { lineHeight: '1.2', fontWeight: '600' }],
        'headline-md': ['28px', { lineHeight: '1.3', fontWeight: '500' }],
        'display-lg': [
          '64px',
          { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' },
        ],
        'headline-lg': ['40px', { lineHeight: '1.2', fontWeight: '600' }],
        'body-md': ['16px', { lineHeight: '1.5', fontWeight: '400' }],
        'body-lg': ['18px', { lineHeight: '1.6', fontWeight: '400' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
