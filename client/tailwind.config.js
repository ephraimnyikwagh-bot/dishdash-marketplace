/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#00F5C4",
        "primary-dark": "#00A88C",
        ink: "#0A0A0A",
        link: "#007F69",
        orange: {
          50: "#E6FFFA",
          100: "#CCFFF5",
          200: "#99FFEA",
          300: "#66FFDF",
          400: "#33FFD4",
          500: "#00C9A2",
          600: "#00F5C4",
          700: "#00A88C",
          800: "#007F69",
          900: "#005A4B"
        }
      },
      fontFamily: {
        sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
