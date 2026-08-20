/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'Segoe UI', 'sans-serif']
      },
      colors: {
        ink: {
          950: '#0b1220',
          900: '#111827',
          800: '#1e293b'
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.04)'
      }
    }
  },
  plugins: []
};
