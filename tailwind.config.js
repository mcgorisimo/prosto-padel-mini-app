/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      // Project palette (existing CSS vars in index.css). Default Tailwind
      // palettes (slate, indigo, yellow, blue, red, etc.) remain available.
      colors: {
        accent:        '#FF6F61',
        'accent-light':'#D8F34A',
        surface:       '#071F16',
        'app-bg':      '#050F0B',
        'app-border':  '#12382A',
        'warm-white':  '#F5F1E8',
        'soft-beige':  '#FBF8EF',
        coral:         '#FF6F61',
        lime:          '#D8F34A',
        win:           '#D8F34A',
        loss:          '#FF6F61',
      },
    },
  },
  plugins: [],
};
