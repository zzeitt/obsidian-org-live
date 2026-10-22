import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vault = process.env.ORG_TEST_VAULT;
if (!vault) {
  console.error("Set ORG_TEST_VAULT to the path of your test vault, for example:");
  console.error('  ORG_TEST_VAULT="/path/to/TestVault" npm run deploy');
  process.exit(1);
}
const obsidianDir = path.join(vault, ".obsidian");
const pluginDir = path.join(obsidianDir, "plugins", "org-live");

if (!fs.existsSync(obsidianDir)) {
  console.error(`Not an Obsidian vault: ${vault}`);
  process.exit(1);
}

fs.mkdirSync(pluginDir, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  fs.copyFileSync(path.join(root, file), path.join(pluginDir, file));
}

const communityPath = path.join(obsidianDir, "community-plugins.json");
const backupPath = `${communityPath}.org-live-backup`;
if (fs.existsSync(communityPath) && !fs.existsSync(backupPath)) {
  fs.copyFileSync(communityPath, backupPath);
  console.log(`Backed up plugin list to ${backupPath}`);
}
fs.writeFileSync(communityPath, JSON.stringify(["org-live"], null, 2) + "\n");

for (const name of ["org-live-demo.org", "writeup-redacted.org"]) {
  const source = path.join(root, "test", name);
  if (fs.existsSync(source)) {
    const destination = path.join(vault, name);
    fs.copyFileSync(source, destination);
    console.log(`Copied ${name}`);
  }
}

console.log(`Deployed org-live to ${pluginDir}`);
console.log(`Enabled plugins: org-live only`);
