import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { translations } from './translations';

const enTranslations = Object.keys(translations).reduce((acc, key) => {
  acc[key] = key;
  return acc;
}, {} as Record<string, string>);

const savedLanguage = localStorage.getItem('i18nextLng') || 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTranslations },
      sw: { translation: translations },
    },
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18nextLng', lng);
});

export default i18n;