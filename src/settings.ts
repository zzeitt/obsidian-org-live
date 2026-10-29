import { LanguageSetting } from "./i18n";

export interface OrgLiveSettings {
  /** UI language for the settings page and plugin actions. */
  language: LanguageSetting;
  /** Extra Org TODO keywords: "active1 active2 | done1 done2". */
  todoKeywords: string;
  /** Show rendered syntax while editing (live preview). */
  livePreview: boolean;
  /** Replace inactive tables with real HTML tables. */
  renderTables: boolean;
  /** Render $...$ and $$...$$ with MathJax. */
  renderMath: boolean;
  /** Show property drawers as compact metadata. */
  showProperties: boolean;
}

export const DEFAULT_SETTINGS: OrgLiveSettings = {
  language: "auto",
  todoKeywords: "",
  livePreview: true,
  renderTables: true,
  renderMath: true,
  showProperties: true,
};
