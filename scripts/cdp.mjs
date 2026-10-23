/**
 * Tiny CDP driver for the running Obsidian window.
 *
 * Usage:
 *   node scripts/cdp.mjs --eval "expression"
 *   node scripts/cdp.mjs --open org-live-demo.org --mode live --cursor 1 --shot out.png
 *   node scripts/cdp.mjs --mode preview --shot preview.png
 *   node scripts/cdp.mjs --info
 */
import fs from "node:fs";

const args = process.argv.slice(2);
function arg(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const port = Number(process.env.CDP_PORT || arg("port", 9222));
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const targetTitle = arg("target");
const pages = targets.filter((target) => target.type === "page");
const page = targetTitle
  ? pages.find((target) => target.title.includes(String(targetTitle)))
  : pages.find((target) => target.url.startsWith("app://obsidian.md"));
if (!page) {
  console.error("No Obsidian page found on port", port);
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const logs = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
    return;
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = (message.params.args ?? [])
      .map((a) => a.value ?? a.description ?? a.type)
      .join(" ");
    logs.push(`[${message.params.type}] ${text}`);
  }
  if (message.method === "Runtime.exceptionThrown") {
    logs.push(`[exception] ${message.params.exceptionDetails?.text ?? ""} ${
      message.params.exceptionDetails?.exception?.description ?? ""
    }`);
  }
  if (message.method === "Log.entryAdded") {
    logs.push(`[log:${message.params.entry.level}] ${message.params.entry.text}`);
  }
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve);
  socket.addEventListener("error", reject);
});

await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");

const mobile = arg("mobile");
const viewport = arg("viewport");
if (mobile) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send("Runtime.evaluate", {
    expression: "document.body.classList.add('is-mobile')",
  });
} else if (viewport) {
  const [width, height] = String(viewport)
    .split("x")
    .map((value) => Number(value));
  await send("Emulation.setDeviceMetricsOverride", {
    width: width || 1280,
    height: height || 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.result?.exceptionDetails) {
    const details = response.result.exceptionDetails;
    console.error("Evaluation failed:", details.text, details.exception?.description ?? "");
    return undefined;
  }
  return response.result?.result?.value;
}

const expectedVault = arg("expect-vault");
if (expectedVault) {
  const actualVault = await evaluate("app.vault.getName()");
  if (actualVault !== expectedVault) {
    console.error(
      `Refusing to operate: expected vault "${expectedVault}", but Obsidian has "${actualVault}" open.`
    );
    socket.close();
    process.exit(1);
  }
}

const targetPath = arg("open");
if (targetPath) {
  const opened = await evaluate(`(async () => {
    const path = ${JSON.stringify(targetPath)};
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) return "missing:" + path;
    let leaf = app.workspace.getLeavesOfType("markdown").concat(app.workspace.getLeavesOfType("org-live-view"))[0];
    if (!leaf) leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return "opened:" + path + ":" + leaf.view.getViewType();
  })()`);
  console.log(opened);
}

const mode = arg("mode");
if (mode) {
  const result = await evaluate(`(() => {
    const v = app.workspace.activeLeaf?.view;
    if (!v || v.getViewType() !== "org-live-view") return "not-org-view:" + (v?.getViewType?.() ?? "none");
    const preview = v.contentEl.classList.contains("is-preview-mode");
    const want = ${JSON.stringify(mode)} === "preview";
    if (preview !== want) v.toggleMode();
    return "mode:" + (v.contentEl.classList.contains("is-preview-mode") ? "preview" : "live");
  })()`);
  console.log(result);
}

const cursor = arg("cursor");
if (cursor) {
  const result = await evaluate(`(() => {
    const v = app.workspace.activeLeaf?.view;
    if (!v || v.getViewType() !== "org-live-view" || !v.editor) return "not-org-view";
    const line = Math.max(1, Math.min(v.editor.state.doc.lines, ${Number(cursor)}));
    const from = v.editor.state.doc.line(line).from;
    v.editor.dispatch({ selection: { anchor: from }, scrollIntoView: true });
    v.editor.focus();
    return "cursor-line:" + line;
  })()`);
  console.log(result);
}

const scroll = arg("scroll");
if (scroll) {
  await evaluate(`(() => {
    const v = app.workspace.activeLeaf?.view;
    if (!v) return;
    if (v.contentEl.classList.contains("is-preview-mode")) {
      const preview = v.previewHost?.querySelector(".org-preview");
      if (preview) preview.scrollTop = ${Number(scroll)};
    } else if (v.editor) {
      v.editor.scrollDOM.scrollTop = ${Number(scroll)};
    }
  })()`);
}

const expression = arg("eval");
if (expression) {
  const value = await evaluate(String(expression));
  console.log(value === undefined ? "undefined" : JSON.stringify(value, null, 2));
}

const wait = Number(arg("wait", 0));
if (wait) await new Promise((resolve) => setTimeout(resolve, wait));

const shot = arg("shot");
if (shot) {
  const response = await send("Page.captureScreenshot", { format: "png" });
  const data = response.result?.data;
  if (!data) {
    console.error("Screenshot failed", JSON.stringify(response));
  } else {
    fs.writeFileSync(shot, Buffer.from(data, "base64"));
    console.log(`Screenshot: ${shot}`);
  }
}

if (mobile) {
  await send("Runtime.evaluate", {
    expression: "document.body.classList.remove('is-mobile')",
  });
  await send("Emulation.clearDeviceMetricsOverride");
} else if (viewport) {
  await send("Emulation.clearDeviceMetricsOverride");
}

if (arg("info")) {
  const info = await evaluate(`(() => {
    const v = app.workspace.activeLeaf?.view;
    return {
      vault: app.vault.getName(),
      file: v?.file?.path ?? null,
      viewType: v?.getViewType?.() ?? null,
      preview: v?.contentEl?.classList?.contains("is-preview-mode") ?? null,
      plugins: app.plugins?.enabledPlugins ? Array.from(app.plugins.enabledPlugins) : [],
      errors: Array.from(document.querySelectorAll(".notice")).map(n => n.textContent).slice(0, 10),
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
}

if (logs.length > 0) {
  console.log("--- console ---");
  for (const line of logs.slice(-40)) console.log(line);
}

socket.close();
