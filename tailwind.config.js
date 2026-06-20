/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './views/**/*.njk',
    './src/client/**/*.{ts,js}',
    './src/**/*.controller.ts',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
