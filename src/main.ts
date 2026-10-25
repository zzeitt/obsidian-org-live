import {
  App,
  loadMathJax,
  loadPrism,
  Notice,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
} from "obsidian";
import { VIEW_TYPE_ORG } from "./constants";
import {
  resolveLanguage,
  translate,
  TranslationKey,
  UiLanguage,
} from "./i18n";
import type { PrismLike } from "./org/highlight";
import { setPrismInstance } from "./org/highlight";
import { OrgOutlineBridge } from "./integration/outline";
import { DEFAULT_SETTINGS, OrgLiveSettings } from "./settings";
import { OrgView } from "./view/OrgView";

export default class OrgLivePlugin extends Plugin {
  settings: OrgLiveSettings = { ...DEFAULT_SETTINGS };
  outline!: OrgOutlineBridge;

  get uiLanguage(): UiLanguage {
    return resolveLanguage(this.settings.language);
  }

  t(key: TranslationKey): string {
    return translate(this.uiLanguage, key);
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    this.outline = new OrgOutlineBridge(this.app, this);
    this.outline.start();

    this.registerView(VIEW_TYPE_ORG, (leaf) => new OrgView(leaf, this));

    try {
      this.registerExtensions(["org"], VIEW_TYPE_ORG);
    } catch (error) {
      console.error("Org Live: unable to register the .org extension", error);
      new Notice(this.t("notice.extensionConflict"));
    }

    this.addCommand({
      id: "toggle-reading-view",
      name: this.t("command.toggleReadingView"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(OrgView);
        if (!view) return false;
        if (!checking) view.toggleMode();
        return true;
      },
    });

    this.addCommand({
      id: "cycle-todo",
      name: this.t("command.cycleTodo"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(OrgView);
        if (!view) return false;
        if (!checking) view.cycleTodo();
        return true;
      },
    });

    this.addCommand({
      id: "focus-live-preview",
      name: this.t("command.enterLivePreview"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(OrgView);
        if (!view) return false;
        if (!checking) view.setMode("live");
        return true;
      },
    });

    this.addSettingTab(new OrgLiveSettingTab(this.app, this));

    // MathJax and Prism are loaded lazily by Obsidian. Refresh Org views once
    // they are ready so math and code rendered before load get upgraded.
    void Promise.allSettled([
      loadMathJax(),
      loadPrism().then((instance) => setPrismInstance(instance as PrismLike)),
    ])
      .then(() => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ORG)) {
          if (leaf.view instanceof OrgView) leaf.view.refreshSettings();
        }
      })
      .catch((error) => console.warn("Org Live: unable to load MathJax/Prism", error));
  }

  onunload(): void {
    this.outline?.destroy();
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<OrgLiveSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
  }

  async saveSettings(options: { refreshEditors?: boolean } = {}): Promise<void> {
    await this.saveData(this.settings);
    this.refreshCommandNames();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ORG)) {
      if (!(leaf.view instanceof OrgView)) continue;
      if (options.refreshEditors === false) leaf.view.refreshLocale();
      else leaf.view.refreshSettings();
    }
  }

  /**
   * Obsidian has no public rename API for commands. The command registry is
   * stable in practice; update names in place when the language changes. If it
   * is unavailable, command names simply keep their startup language.
   */
  private refreshCommandNames(): void {
    const commands = (this.app as unknown as {
      commands?: { commands?: Record<string, { name?: string }> };
    }).commands?.commands;
    if (!commands) return;

    const names: Record<string, string> = {
      "org-live:toggle-reading-view": this.t("command.toggleReadingView"),
      "org-live:cycle-todo": this.t("command.cycleTodo"),
      "org-live:focus-live-preview": this.t("command.enterLivePreview"),
    };
    for (const [id, name] of Object.entries(names)) {
      const command = commands[id];
      if (command) command.name = name;
    }
  }
}

class OrgLiveSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: OrgLivePlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: this.plugin.t("settings.language"),
        desc: this.plugin.t("settings.languageDesc"),
        control: {
          type: "dropdown",
          key: "language",
          options: {
            auto: this.plugin.t("settings.languageAuto"),
            en: this.plugin.t("settings.languageEn"),
            zh: this.plugin.t("settings.languageZh"),
          },
        },
      },
      {
        name: this.plugin.t("settings.livePreview"),
        desc: this.plugin.t("settings.livePreviewDesc"),
        control: { type: "toggle", key: "livePreview" },
      },
      {
        name: this.plugin.t("settings.renderTables"),
        desc: this.plugin.t("settings.renderTablesDesc"),
        control: { type: "toggle", key: "renderTables" },
      },
      {
        name: this.plugin.t("settings.renderMath"),
        desc: this.plugin.t("settings.renderMathDesc"),
        control: { type: "toggle", key: "renderMath" },
      },
      {
        name: this.plugin.t("settings.showProperties"),
        desc: this.plugin.t("settings.showPropertiesDesc"),
        control: { type: "toggle", key: "showProperties" },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings({ refreshEditors: key !== "language" });
    if (key === "language") this.update();
  }


}
