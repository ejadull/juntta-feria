/** Lowercase without diacritics: "Jabonería" matches "jaboneria", "Neuquén" matches "neuquen". */
export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
