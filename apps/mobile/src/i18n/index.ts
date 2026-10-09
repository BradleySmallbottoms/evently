import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import sv from './locales/sv.json';

const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'sv';
const lng = deviceLocale === 'en' ? 'en' : 'sv';

void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  resources: {
    sv: { translation: sv },
    en: { translation: en },
  },
  lng,
  fallbackLng: 'sv',
  interpolation: { escapeValue: false },
});

export default i18n;
