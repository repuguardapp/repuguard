export const LOCALES = ['fr', 'en', 'es', 'de', 'pt-br'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';
