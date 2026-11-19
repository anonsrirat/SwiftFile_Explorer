import { useApp } from "@/stores/app";
import { translate, type I18nKey } from "./i18n";

export function useT() {
  const language = useApp((s) => s.settings.language);
  return (key: I18nKey) => translate(language, key);
}
