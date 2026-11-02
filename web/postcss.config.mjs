// Tailwind via PostCSS only for the webpack build used to deploy to Firebase Hosting
// (IS_WEBPACK_TEST=1). Dev and normal builds use Turbopack with @tailwindcss/turbopack (next.config.ts).
const config = {
  plugins: process.env.IS_WEBPACK_TEST ? { "@tailwindcss/postcss": {} } : {},
};

export default config;
