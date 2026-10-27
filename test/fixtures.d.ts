// Vitest (through Vite) imports fixture files as text with `?raw`.
declare module '*.html?raw' {
  const html: string;
  export default html;
}
