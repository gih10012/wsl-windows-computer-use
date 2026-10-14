#!/usr/bin/env node
"use strict";
// Local stdio MCP adapter: native Windows or WSL -> Windows Node -> PowerShell/UIA.
// No HTTP service, API credentials, telemetry, or application injection.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const SOURCE = process.env.WCU_SOURCE_DIR || path.join(__dirname, "backend");
let localAppData;
const EXPOSED = new Set([
  "windows_computer_use_status", "list_apps", "get_app_state", "dump_app_targets",
  "screenshot_window", "click", "perform_secondary_action", "scroll", "drag",
  "press_key", "type_text", "set_value",
  "move_mouse", "close_window", "batch",
]);

const POINT_PROPERTIES = {
  app: { type: "string", description: "Exact pid:N or hwnd:0xHEX from observed state." },
  expectedWindowTitle: { type: "string", description: "Exact title from the latest get_app_state. Required for browser input so a tab switch stops the action." },
  x: { type: "number" }, y: { type: "number" },
  coordinateSpace: { type: "string", enum: ["screenshot", "window", "screen"], default: "screenshot" },
};
const BATCH_ACTIONS = ["move_mouse", "click", "drag", "scroll", "press_key", "type_text", "set_value", "perform_secondary_action"];
const CUSTOM_TOOLS = [
  { name: "move_mouse", description: "Move the real Windows mouse pointer to an observed coordinate. Verifies target focus and rejects overlapping windows.", inputSchema: { type: "object", properties: POINT_PROPERTIES, required: ["app", "x", "y"] } },
  { name: "close_window", description: "Request a normal close of an exact observed window, without killing its process or dismissing unsaved-work prompts. Use to clean up windows opened for the task; do not close pre-existing windows unless asked.", inputSchema: { type: "object", properties: { app: POINT_PROPERTIES.app, expectedWindowTitle: POINT_PROPERTIES.expectedWindowTitle }, required: ["app"] } },
  { name: "batch", description: "Run up to 32 already-grounded GUI actions sequentially in one call, against one observed window. Stop at the first error and report completed actions; never retry automatically. Do not batch blind coordinates across navigation or layout changes.", inputSchema: {
    type: "object", properties: { app: POINT_PROPERTIES.app, expectedWindowTitle: POINT_PROPERTIES.expectedWindowTitle, include_screenshot: { type: "boolean", default: true }, actions: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: { tool: { type: "string", enum: BATCH_ACTIONS }, arguments: { type: "object" }, delayMs: { type: "integer", minimum: 0, maximum: 1000 } }, required: ["tool", "arguments"] } } }, required: ["app", "actions"]
  } },
];

function localPath(windowsPath) {
  const normalized = windowsPath.replace(/\\+/g, "/");
  if (process.platform === "win32") return normalized;
  const match = /^([a-z]):\/(.*)$/i.exec(normalized);
  if (!match) throw new Error("Expected an absolute Windows path");
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function windowsPath(file) {
  if (process.platform === "win32") return path.resolve(file);
  const match = /^\/mnt\/([a-z])\/(.*)$/i.exec(path.resolve(file));
  if (!match) throw new Error("Install this plugin on a Windows-mounted drive so the Windows backend can read it");
  return `${match[1].toUpperCase()}:/${match[2]}`;
}

function launch() {
  const server = windowsPath(path.join(SOURCE, "mcp-server.js"));
  const environment = { ...process.env, WINDOWS_COMPUTER_USE_PREWARM_BRIDGE: "0",
    WINDOWS_COMPUTER_USE_BRIDGE_DAEMON: "0", MCP_CONTENT_LENGTH: "0" };
  if (process.platform === "win32") {
    localAppData = process.env.LOCALAPPDATA;
    return spawn(process.execPath, [server], { env: environment, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"] });
  }
  if (!environment.WSL_INTEROP || !fs.existsSync(environment.WSL_INTEROP)) {
    const sockets = fs.readdirSync("/run/WSL").filter(name => /^\d+_interop$/.test(name))
      .map(name => `/run/WSL/${name}`).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!sockets.length) throw new Error("WSL Windows interoperability is unavailable");
    environment.WSL_INTEROP = sockets[0];
  }
  const powershell = process.env.WCU_POWERSHELL || "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
  const discovery = "$n=(Get-Command node.exe -ErrorAction SilentlyContinue).Source; if (!$n) { $n=Get-ChildItem ($env:LOCALAPPDATA+'\\OpenAI\\Codex\\runtimes\\cua_node\\*\\bin\\node.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName }; @{node=$n;localAppData=$env:LOCALAPPDATA} | ConvertTo-Json -Compress";
  const info = JSON.parse(execFileSync("/init", [powershell, "-NoProfile", "-NonInteractive", "-Command", discovery],
    { env: environment, encoding: "utf8", input: "", timeout: 15000 }).trim());
  if (!info.node) throw new Error("Install Node.js on Windows; no Windows Node runtime was found");
  localAppData = info.localAppData;
  // Explicit /init avoids this machine's stale /tools/init binfmt registration.
  return spawn("/init", [localPath(info.node), server], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
}

const child = launch();
let outputBuffer = "";
let nextId = 0;
let stopped = false;
const pending = new Map();
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", chunk => process.stderr.write(chunk));
child.stdout.on("data", chunk => {
  outputBuffer += chunk;
  let newline;
  while ((newline = outputBuffer.indexOf("\n")) >= 0) {
    const line = outputBuffer.slice(0, newline).trim();
    outputBuffer = outputBuffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { fail(new Error("Invalid JSON from Windows MCP backend")); continue; }
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    clearTimeout(waiter.timer);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  }
});
child.on("error", fail);
child.on("exit", code => {
  fail(new Error(`Windows MCP backend exited (${code})`));
  if (!stopped) process.exit(1);
});

function fail(error) {
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
  pending.clear();
}

function rpc(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Windows MCP ${method} timed out; input was not retried`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function dataOf(result) {
  if (result.structuredContent) return result.structuredContent;
  if (result._meta?.raw) return result._meta.raw;
  for (const block of result.content || []) {
    if (block.type !== "text") continue;
    try { return JSON.parse(block.text); } catch {}
  }
  return null;
}

function addScreenshot(result, data) {
  if (!data?.screenshot?.path) return;
  const file = fs.realpathSync(localPath(data.screenshot.path));
  const allowed = fs.realpathSync(localPath(`${localAppData}/codex-plusplus/windows-computer-use`));
  if (path.dirname(file) !== allowed || !/^screenshot-\d+-\d+\.png$/.test(path.basename(file))) {
    throw new Error("Refusing to attach a file outside the Windows screenshot directory");
  }
  if (fs.statSync(file).size > 12 * 1024 * 1024) throw new Error("Window screenshot exceeds 12 MiB; choose a smaller window");
  const png = fs.readFileSync(file);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid screenshot PNG");
  result.content.push({ type: "image", mimeType: "image/png", data: png.toString("base64") });
}

async function dispatch(method, params = {}) {
  if (method === "initialize") {
    const hello = await rpc(method, { ...params, capabilities: {} });
    return { ...hello, serverInfo: { name: "windows-desktop", version: "0.1.0" },
      instructions: "Local Windows desktop shared with the user. Observe fresh state before actions. Use exact pid:N targets; screenshot coordinates are physical window-relative pixels. type_text uses Unicode paste and restores the clipboard." };
  }
  if (method === "ping") return {};
  if (method === "tools/list") {
    const result = await rpc(method, params);
    result.tools = result.tools.filter(tool => EXPOSED.has(tool.name)).map(tool => {
      const properties = tool.inputSchema.properties;
      if (properties.app) properties.app.description = "Exact pid:N or hwnd:0xHEX from list_apps (preferred), or a unique process/window name.";
      if (properties.app && !["get_app_state", "screenshot_window", "dump_app_targets"].includes(tool.name)) properties.expectedWindowTitle = POINT_PROPERTIES.expectedWindowTitle;
      if (properties.showFakeCursor) properties.showFakeCursor.default = false;
      if (["click", "scroll", "drag"].includes(tool.name)) {
        tool.inputSchema.required = [...new Set([...(tool.inputSchema.required || []), "app"])];
        if (properties.coordinateSpace) properties.coordinateSpace.default = "screenshot";
      }
      if (tool.name === "type_text") tool.description = "Insert literal Unicode text by Ctrl+V, preserving clipboard formats. Works with Chinese IME without switching the user's input language. Requires an observed, focused text field; verify the inserted value afterwards.";
      if (tool.name === "click") tool.description = "Click an observed UIA element or coordinate using native Windows SendInput by default. Moves the real pointer for coordinate clicks; verifies target focus and rejects unrelated overlapping windows.";
      if (tool.name === "drag") {
        tool.description = "Drag the real Windows pointer between two observed points while holding the left button. Verifies focus, requires both points inside the target window, and always releases the button on error.";
        properties.coordinateSpace = POINT_PROPERTIES.coordinateSpace;
        properties.durationMs = { type: "integer", minimum: 100, maximum: 5000, default: 600 };
      }
      if (tool.name === "scroll") {
        tool.description = "Scroll at an observed point using the native Windows mouse wheel; moves the real pointer and verifies target ownership.";
        properties.x = POINT_PROPERTIES.x; properties.y = POINT_PROPERTIES.y;
        properties.coordinateSpace = POINT_PROPERTIES.coordinateSpace;
        properties.ticks = { type: "integer", minimum: 1, maximum: 20, default: 3 };
        tool.inputSchema.required = ["app", "x", "y", "direction"];
      }
      if (["get_app_state", "screenshot_window"].includes(tool.name)) {
        tool.description += " Returns a target-window inline PNG and physical-pixel geometry; normally uses PrintWindow without stealing focus.";
        properties.include_screenshot = { type: "boolean", default: true, description: "Attach the PNG image to the MCP result; false omits the image payload." };
      }
      return tool;
    });
    result.tools.push(...CUSTOM_TOOLS);
    return result;
  }
  if (method === "tools/call") {
    const { name } = params;
    if (!EXPOSED.has(name)) throw new Error(`Unavailable tool: ${name}`);
    if (name === "batch") {
      const batch = params.arguments || {};
      if (!batch.app || !Array.isArray(batch.actions) || batch.actions.length < 1 || batch.actions.length > 32) throw new Error("batch requires app and 1..32 actions");
      // Validate the complete sequence before allowing its first side effect.
      for (const action of batch.actions) {
        if (!BATCH_ACTIONS.includes(action.tool) || !action.arguments || typeof action.arguments !== "object") throw new Error("Invalid batch action");
        if (action.arguments.app && action.arguments.app !== batch.app) throw new Error("All batch actions must target the same observed app");
        if (action.delayMs !== undefined && (!Number.isInteger(action.delayMs) || action.delayMs < 0 || action.delayMs > 1000)) throw new Error("Batch delay must be 0..1000ms");
      }
      const completed = [];
      let failure = null;
      const started = Date.now();
      for (const action of batch.actions) {
        try {
          if (Date.now() - started > 30000) throw new Error("Batch time limit reached; remaining actions were not run");
          const result = await dispatch("tools/call", { name: action.tool, arguments: { ...action.arguments, app: batch.app, expectedWindowTitle: batch.expectedWindowTitle } });
          if (result.isError) throw new Error(JSON.stringify(dataOf(result) || result.content));
          completed.push({ tool: action.tool, result: dataOf(result) || result.content });
          if (action.delayMs) await new Promise(resolve => setTimeout(resolve, action.delayMs));
        } catch (error) { failure = { index: completed.length, tool: action.tool, message: error.message }; break; }
      }
      const data = { status: failure ? "partial-or-failed" : "ok", completedCount: completed.length, results: completed, failure };
      const result = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: !!failure };
      if (batch.include_screenshot !== false) {
        try { const state = await dispatch("tools/call", { name: "get_app_state", arguments: { app: batch.app } }); result.content.push(...state.content); }
        catch (error) { result.content.push({ type: "text", text: `Final screenshot unavailable: ${error.message}` }); }
      }
      return result;
    }
    const args = { ...(params.arguments || {}), includeStructuredContent: true, showFakeCursor: false };
    if (name === "list_apps") args.detailed = true;
    if ([...BATCH_ACTIONS, "close_window"].includes(name) && !args.app) throw new Error("A target app is required");
    if (["click", "scroll", "drag"].includes(name)) args.inputMethod = args.inputMethod || "send-input";
    if (["click", "scroll", "drag", "move_mouse"].includes(name) && args.coordinateSpace === undefined) args.coordinateSpace = "screenshot";
    const result = await rpc(method, { ...params, arguments: args });
    const data = dataOf(result);
    if (data && typeof data === "object" && !Array.isArray(data)) result.structuredContent = data;
    if (["get_app_state", "screenshot_window"].includes(name) && args.include_screenshot !== false && !result.isError) addScreenshot(result, data);
    return result;
  }
  throw new Error(`Unsupported MCP method: ${method}`);
}

let inputBuffer = "";
let serial = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  inputBuffer += chunk;
  let newline;
  while ((newline = inputBuffer.indexOf("\n")) >= 0) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }) + "\n"); continue; }
    // Serialize GUI calls so focus and clipboard cannot race within a session.
    serial = serial.then(async () => {
      if (message.id === undefined) {
        child.stdin.write(JSON.stringify(message) + "\n");
        return;
      }
      try {
        const result = await dispatch(message.method, message.params);
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
      } catch (error) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error.message } }) + "\n");
      }
    }).catch(error => process.stderr.write(error.message + "\n"));
  }
});

function stop() {
  if (stopped) return;
  stopped = true;
  fail(new Error("MCP client disconnected"));
  child.stdin.end();
  child.kill();
  process.exit(0);
}
process.stdin.on("end", () => serial.finally(stop));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
