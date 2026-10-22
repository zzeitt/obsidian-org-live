import { getLanguage } from "obsidian";

export type LanguageSetting = "auto" | "en" | "zh";
export type UiLanguage = "en" | "zh";

const en = {
  "settings.intro": "Rendering and editor options for Org files.",
  "settings.language": "Interface language",
  "settings.languageDesc":
    "Language used by this settings page and Org Live actions. Changes apply immediately.",
  "settings.languageAuto": "Automatic (follow Obsidian)",
  "settings.languageEn": "English",
  "settings.languageZh": "中文",
  "settings.livePreview": "Live preview",
  "settings.livePreviewDesc":
    "Render Org syntax while editing, the way Obsidian renders Markdown.",
  "settings.renderTables": "Render tables",
  "settings.renderTablesDesc":
    "Show tables as real tables when the cursor is outside them.",
  "settings.renderMath": "Render math",
  "settings.renderMathDesc":
    "Render $...$ and $$...$$ with Obsidian's math renderer.",
  "settings.showProperties": "Show property drawers",
  "settings.showPropertiesDesc":
    "Render :PROPERTIES: drawers and leading #+KEYWORD metadata as compact cards.",
  "action.livePreview": "Live preview",
  "action.readingView": "Reading view",
  "command.toggleReadingView": "Toggle reading view",
  "command.cycleTodo": "Cycle TODO state",
  "command.enterLivePreview": "Enter live preview",
  "notice.extensionConflict":
    "Org Live could not register .org files. Another plugin may already handle them (for example Orgmode cm6).",
} as const;

export type TranslationKey = keyof typeof en;

const zh: Record<TranslationKey, string> = {
  "settings.intro": "Org 文件的渲染与编辑器选项。",
  "settings.language": "界面语言",
  "settings.languageDesc": "本设置页和 Org Live 操作使用的语言，修改后立即生效。",
  "settings.languageAuto": "自动（跟随 Obsidian）",
  "settings.languageEn": "English",
  "settings.languageZh": "中文",
  "settings.livePreview": "实时预览",
  "settings.livePreviewDesc": "编辑时按 Obsidian 渲染 Markdown 的方式渲染 Org 语法。",
  "settings.renderTables": "渲染表格",
  "settings.renderTablesDesc": "光标不在表格内时，显示为真实表格。",
  "settings.renderMath": "渲染数学",
  "settings.renderMathDesc": "使用 Obsidian 的数学渲染器渲染 $...$ 和 $$...$$。",
  "settings.showProperties": "显示属性抽屉",
  "settings.showPropertiesDesc":
    "把 :PROPERTIES: 抽屉和顶部 #+KEYWORD 元数据渲染为紧凑卡片。",
  "action.livePreview": "实时预览",
  "action.readingView": "阅读视图",
  "command.toggleReadingView": "切换阅读视图",
  "command.cycleTodo": "循环切换 TODO 状态",
  "command.enterLivePreview": "进入实时预览",
  "notice.extensionConflict":
    "Org Live 无法注册 .org 文件，可能已有其他插件接管（例如 Orgmode cm6）。",
};

export function resolveLanguage(setting: LanguageSetting): UiLanguage {
  if (setting !== "auto") return setting;
  try {
    const current = (getLanguage as (() => string) | undefined)?.() ?? "";
    if (current.toLowerCase().startsWith("zh")) return "zh";
  } catch {
    // Older Obsidian versions may not expose getLanguage().
  }
  return "en";
}

export function translate(language: UiLanguage, key: TranslationKey): string {
  return language === "zh" ? zh[key] : en[key];
}
