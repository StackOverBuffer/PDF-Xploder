/** Hunspell files of the dictionary packages, as text (vite.config.ts aliases the folder). */
declare module 'spell-dictionaries/*?raw' {
  const text: string;
  export default text;
}
