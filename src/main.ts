import {
  App,
  loadMathJax,
  loadPrism,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { VIEW_TYPE_ORG } from "./constants";
import {
  LanguageSetting,
  resolveLanguage,
  translate,
  TranslationKey,
  UiLanguage,
} from "./i18n";
import { setPrismInstance } from "./org/highlight";
import { DEFAULT_SETTINGS, OrgLiveSettings } from "./settings";
import { OrgView } from "./view/OrgView";

export default class OrgLivePlugin extends Plugin {
  settings: OrgLiveSettings = { ...DEFAULT_SETTINGS };

  get uiLanguage(): UiLanguage {
    return resolveLanguage(this.settings.language);
  }

  t(key: TranslationKey): string {
    return translate(this.uiLanguage, key);
  }

  async onload(): Promise<void> {
    await this.loadSettings();

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
      loadPrism().then((instance) => setPrismInstance(instance)),
    ])
      .then(() => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ORG)) {
          if (leaf.view instanceof OrgView) leaf.view.refreshSettings();
        }
      })
      .catch((error) => console.warn("Org Live: unable to load MathJax/Prism", error));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Org Live" });
    containerEl.createEl("p", {
      text: this.plugin.t("settings.intro"),
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(this.plugin.t("settings.language"))
      .setDesc(this.plugin.t("settings.languageDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", this.plugin.t("settings.languageAuto"))
          .addOption("en", this.plugin.t("settings.languageEn"))
          .addOption("zh", this.plugin.t("settings.languageZh"))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as LanguageSetting;
            await this.plugin.saveSettings({ refreshEditors: false });
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.livePreview"))
      .setDesc(this.plugin.t("settings.livePreviewDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.livePreview).onChange(async (value) => {
          this.plugin.settings.livePreview = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.renderTables"))
      .setDesc(this.plugin.t("settings.renderTablesDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.renderTables).onChange(async (value) => {
          this.plugin.settings.renderTables = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.renderMath"))
      .setDesc(this.plugin.t("settings.renderMathDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.renderMath).onChange(async (value) => {
          this.plugin.settings.renderMath = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.showProperties"))
      .setDesc(this.plugin.t("settings.showPropertiesDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showProperties).onChange(async (value) => {
          this.plugin.settings.showProperties = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
