/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // ===== TYPOGRAPHY =====
      // Three families with clear roles:
      //   display = headings, card titles, scholarly emphasis (Cormorant Garamond)
      //   serif   = card body text, modal article surfaces (Spectral — JSTOR-like)
      //   sans    = UI controls, buttons, form labels (IBM Plex Sans)
      //   mono    = years, citations, sequence numbers, tags (JetBrains Mono)
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        serif: ['Spectral', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },

      // ===== COLOR PALETTE — Victorian binding =====
      // The peacock-teal ground from the reference book cover, paired with
      // antique gold ornament and aged-cream paper. Oxblood retained for
      // failure states; verdigris for success.
      colors: {
        // Peacock teal — the dominant ground. Deep, slightly desaturated.
        teal: {
          950: '#0c1f22',  // deepest — page background
          900: '#143138',  // primary panel ground
          800: '#1a3a3f',  // raised surface (book cover ground)
          700: '#234851',
          600: '#2f5a64',
          500: '#3f7079',
        },
        // Antique gold — gilt stamping, ornament, accents
        gold: {
          300: '#e6c98a',
          400: '#d4ae5e',
          500: '#b8923a',  // primary gold — gilt rules and ornaments
          600: '#8e6f24',
          700: '#665015',
        },
        // Aged cream — paper for cards and document modals
        cream: {
          50:  '#fdf8ea',  // brightest paper (card highlight)
          100: '#f4ead0',  // primary paper
          200: '#e7d8b1',  // shadow paper
          300: '#d4c08a',
          400: '#b8a36a',
        },
        // Oxblood — danger, failure, deletion. Saturated 19th-century red.
        oxblood: {
          300: '#d98a94',  // light brick — danger TEXT on dark grounds (passes AA)
          500: '#7a2331',
          600: '#5a1a25',
          700: '#3f111a',
        },
        // Verdigris — success, publication, advancement. Aged copper green.
        verdigris: {
          400: '#7ba087',
          500: '#52755e',
          600: '#3a5544',
        },
        // Ink — for text on cream surfaces, like fountain-pen on paper
        ink: {
          900: '#1a1410',
          800: '#2a2218',
          700: '#3f3324',
        },
        // Wood — warm brown for project space surfaces (worktable / clipboard)
        wood: {
          900: '#2a1d12',  // deepest, for shadows and slot impressions
          800: '#3d2c1d',  // dark wood
          700: '#5a4129',  // primary wood surface
          600: '#76563a',  // raised highlights
          500: '#937050',  // grain accents
        },
      },

      // ===== EFFECTS =====
      boxShadow: {
        // Cards on the desk — paper has weight, casts shadow on teal ground
        card: '0 2px 8px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.7)',
        'card-hover': '0 8px 16px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.7)',
        'card-lift': '0 16px 32px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.7)',
        // Sunken inset for project slots, archive shelves
        well: 'inset 0 2px 8px rgba(0,0,0,0.55)',
        // Gold-glow for hover/focus on ornamented elements
        gilt: '0 0 0 1px rgba(212, 174, 94, 0.4), 0 2px 8px rgba(0,0,0,0.4)',
      },

      // For elegant motion micro-interactions
      transitionTimingFunction: {
        'desk': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
