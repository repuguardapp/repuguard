import { getRequestConfig } from 'next-intl/server';
import { LOCALES, DEFAULT_LOCALE, type Locale } from './locales';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !LOCALES.includes(locale as Locale)) {
    locale = DEFAULT_LOCALE;
  }
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
