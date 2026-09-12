/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './App.tsx', './index.tsx', './components/**/*.{ts,tsx}', './services/**/*.{ts,tsx}'],
  // Hover-Varianten nur auf Geraeten mit echtem Zeiger. Auf Touch loest Hover
  // beim Tippen aus und bleibt haengen — ein Zustand, den niemand wollte.
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      // Primaerfarben der SvT Brand Guideline. Als echte Tokens statt
      // CSS-Variablen, damit Deckkraft-Modifikatoren greifen (`bg-svt-green/15`)
      // — auf `var(--…)` mit Hex-Wert funktioniert das in Tailwind 3 nicht.
      colors: {
        svt: {
          green: '#1f3a2e',
          sage: '#8fa79b',
          sand: '#d6c3a3',
          cream: '#f2eee6',
          paper: '#fbfaf7',
        },
      },
      // Zuordnung wie in der Guideline: Titel · Text · Highlights.
      fontFamily: {
        titel: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['"Creato Display"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        highlight: ['"Bebas Neue"', 'Montserrat', 'ui-sans-serif', 'sans-serif'],
      },
      // Kraeftigere Kurven als die eingebauten. Kein `ease-in`: startet langsam
      // und wirkt genau dann traege, wenn der Nutzer hinsieht.
      transitionTimingFunction: {
        'svt-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'svt-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
      },
    },
  },
  plugins: [],
};
