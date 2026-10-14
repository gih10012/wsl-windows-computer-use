#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const { execFile, spawn } = require("child_process");

const SERVER_NAME = "windows-computer-use";
const SERVER_VERSION = "0.1.0-draft";
const ROOT = __dirname;
const APP_INSTRUCTIONS_DIR = path.join(ROOT, "AppInstructions");
const WINDOWS_BRIDGE = path.join(ROOT, "scripts", "windows-bridge.ps1");
const COMPUTER_USE_ICON = path.join(ROOT, "codex-plugin", "assets", "app-icon.png");
const BRIDGE_PIPE = process.env.WINDOWS_COMPUTER_USE_BRIDGE_PIPE || "\\\\.\\pipe\\codex-plusplus-windows-computer-use";
let input = "";
let bridgeProcess = null;
let bridgeBuffer = "";
let bridgeNextId = 1;
const bridgePending = new Map();
let fastAppsCache = null;
let bridgeWarmupStarted = false;
let bridgeWarmupStartedAt = 0;
let bridgeWarmupCompletedAt = 0;
let bridgeWarmupError = null;

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  drainInput();
});

function drainInput() {
  while (input.length > 0) {
    if (/^Content-Length:/i.test(input)) {
      const headerEnd = input.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = input.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        input = "";
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (input.length < bodyStart + length) return;
      handleMessage(input.slice(bodyStart, bodyStart + length));
      input = input.slice(bodyStart + length);
      continue;
    }

    const newline = input.indexOf("\n");
    if (newline < 0) return;
    const line = input.slice(0, newline).trim();
    input = input.slice(newline + 1);
    if (line) handleMessage(line);
  }
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (!message || message.id == null) return;

  Promise.resolve()
    .then(() => dispatch(message))
    .then((result) => respond({ jsonrpc: "2.0", id: message.id, result }))
    .catch((error) => respond({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    }));
}

function dispatch(message) {
  switch (message.method) {
    case "initialize":
      primeFastAppsCache();
      warmBridgeInBackground();
      return {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: { tools: {} },
      };
    case "tools/list":
      return { tools: tools() };
    case "tools/call":
      return callTool(message.params?.name, message.params?.arguments || {});
    case "ping":
      return {};
    default:
      throw new Error(`Unsupported method: ${message.method}`);
  }
}

async function callTool(name, args) {
  switch (name) {
    case "windows_computer_use_status":
      return content(await status(), args);
    case "start_computer_use":
      return content(startComputerUse(args), args);
    case "windows_computer_use_setup_check":
      return content(await setupCheck(), args);
    case "app_instruction_catalog":
      return content(appInstructionCatalog(), args);
    case "list_apps":
      return content(await listApps(args), args);
    case "get_app_state":
      return content(withAppSpecificInstructions(await bridgeOrUnsupported("get-app-state", "get_app_state", args, ["app"]), args), args);
    case "dump_app_targets":
      return content(await bridgeOrUnsupported("dump-app-targets", "dump_app_targets", args, ["app"]), args);
    case "screenshot_window":
      return content(await bridgeOrUnsupported("screenshot-window", "screenshot_window", args, ["app"]), args);
    case "click":
      return content(await bridgeOrDryRun("click", name, args), args);
    case "perform_secondary_action":
      return content(await bridgeOrDryRun("perform-secondary-action", name, args), args);
    case "scroll":
      return content(await bridgeOrDryRun("scroll", name, args), args);
    case "drag":
      return content(await bridgeOrDryRun("drag", name, args), args);
    case "press_key":
      return content(await bridgeOrDryRun("press-key", name, args), args);
    case "type_text":
      return content(await bridgeOrDryRun("type-text", name, args), args);
    case "set_value":
      return content(await bridgeOrDryRun("set-value", name, args), args);
    case "move_cursor":
      return content(await bridgeOrDryRun("move-cursor", name, args), args);
    case "move_mouse":
      return content(await bridgeOrDryRun("move-mouse", name, args), args);
    case "close_window":
      return content(await bridgeOrDryRun("close-window", name, args), args);
    case "show_fake_cursor":
      return content(await bridgeOrDryRun("show-fake-cursor", name, args), args);
    case "hide_fake_cursor":
      return content(await bridgeOrDryRun("hide-fake-cursor", name, args), args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function tools() {
  return [
    {
      name: "windows_computer_use_status",
      description: "Return platform, capability, and implementation status for the draft Windows Computer Use MCP server.",
      inputSchema: emptySchema(),
    },
    {
      name: "start_computer_use",
      description: "Show a quick Starting Computer Use event and begin warming the Windows PowerShell/UIA bridge in the background before slower app-control tools.",
      inputSchema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Short reason for starting Computer Use, used only for hidden metadata.",
          },
        },
      },
    },
    {
      name: "windows_computer_use_setup_check",
      description: "Run Windows setup diagnostics for UI Automation, screenshots, input, overlay assets, state directory, execution policy, and elevation caveats.",
      inputSchema: emptySchema(),
    },
    {
      name: "app_instruction_catalog",
      description: "List bundled app-specific instruction Markdown files for the Windows Computer Use draft.",
      inputSchema: emptySchema(),
    },
    {
      name: "list_apps",
      description: "List visible Windows desktop apps with display names and extracted app icon paths. On non-Windows platforms, returns an unsupported diagnostic payload.",
      inputSchema: emptySchema(),
    },
    {
      name: "get_app_state",
      description: "Start an app use session if needed, then dump app display metadata, app-specific instructions, window state, screenshot path, a compact accessibility tree, and compact actionable controls with positions. Must be called before action tools.",
      inputSchema: {
        type: "object",
        properties: {
          app: {
            type: "string",
            description: "App name, process name, or window title.",
          },
          includeCursor: {
            type: "boolean",
            description: "Overlay the current system cursor into the screenshot when it falls inside the target window.",
          },
          includeIconData: {
            type: "boolean",
            description: "Include base64 icon data URI. Defaults to false; normal UI should use appDisplay.icon.path.",
          },
          depth: {
            type: "integer",
            description: "UI Automation tree scan depth. Defaults to 4.",
          },
          compact: {
            type: "boolean",
            description: "Return compact tree lines and compact actionable targets. Defaults to true.",
          },
          maxTreeLines: {
            type: "integer",
            description: "Maximum compact accessibility tree lines to return. Defaults to 160.",
          },
          includeRawAccessibilityTree: {
            type: "boolean",
            description: "Also include the old verbose nested UIA tree for debugging. Defaults to false.",
          },
          includeRawViewTargets: {
            type: "boolean",
            description: "Merge high-value controls from UIA RawView into actionable targets. Defaults to true.",
          },
          includeSyntheticTargets: {
            type: "boolean",
            description: "Add reliable geometry/shortcut-backed targets for common app chrome such as browser address bars. Defaults to true.",
          },
          includeActionableElements: {
            type: "boolean",
            description: "Include flattened clickable/editable targets with screen and window-relative positions. Defaults to true.",
          },
          maxActionableElements: {
            type: "integer",
            description: "Maximum actionable targets to include. Defaults to 120.",
          },
          timeoutMs: {
            type: "integer",
            description: "Wait up to this long for a matching app window before returning not-found. Defaults to 0.",
          },
        },
        required: ["app"],
      },
    },
    {
      name: "dump_app_targets",
      description: "Dump a compact flattened list of clickable, editable, selectable, and scrollable UI Automation targets for an app window with button/control positions.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string", description: "App name, process name, or window title." },
          depth: { type: "integer", description: "UI Automation depth to scan. Defaults to 6." },
          maxTargets: { type: "integer", description: "Maximum targets to return. Defaults to 200." },
          compact: { type: "boolean", description: "Return compact target objects. Defaults to true." },
          includeRawTargets: { type: "boolean", description: "Also include verbose target objects for debugging. Defaults to false." },
          includeRawViewTargets: { type: "boolean", description: "Merge high-value controls from UIA RawView. Defaults to true." },
          includeSyntheticTargets: { type: "boolean", description: "Add geometry/shortcut-backed targets for common app chrome. Defaults to true." },
          includeOffscreen: { type: "boolean", description: "Include offscreen UIA elements. Defaults to false." },
          timeoutMs: { type: "integer", description: "Wait up to this long for a matching app window before returning not-found. Defaults to 0." },
        },
        required: ["app"],
      },
    },
    {
      name: "screenshot_window",
      description: "Capture a screenshot of a visible app window and return app display metadata, the PNG path, and dimensions.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string", description: "App name, process name, or window title." },
          includeCursor: { type: "boolean" },
          includeIconData: { type: "boolean", description: "Include base64 icon data URI. Defaults to false; normal UI should use appDisplay.icon.path." },
          timeoutMs: { type: "integer", description: "Wait up to this long for a matching app window before returning not-found. Defaults to 0." },
        },
        required: ["app"],
      },
    },
    {
      name: "click",
      description: "Click an element by index or coordinates without moving the user's real cursor. Use compact target screen=[x,y] centers from target dumps for screen coordinates, or pass coordinateSpace='window'/'screenshot' when using screenshot/window-relative coordinates. Shows the fake software cursor by default.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string" },
          element_index: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          coordinateSpace: {
            type: "string",
            enum: ["auto", "screen", "window", "screenshot"],
            description: "Coordinate space for x/y. Defaults to auto; screen is absolute desktop pixels, window/screenshot adds the target window offset.",
          },
          showFakeCursor: {
            type: "boolean",
            description: "Whether to show the fake cursor overlay while clicking. Defaults to true.",
          },
          style: {
            type: "string",
            enum: ["fog", "lens", "software"],
            description: "Virtual cursor style. Defaults to software, using the extracted macOS Computer Use cursor asset.",
          },
          click_count: { type: "integer", default: 1 },
          mouse_button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
        },
        required: ["app"],
      },
    },
    {
      name: "perform_secondary_action",
      description: "Invoke a secondary UI Automation action exposed by an element.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string" },
          element_index: { type: "string" },
          action: { type: "string" },
        },
        required: ["app", "element_index", "action"],
      },
    },
    {
      name: "scroll",
      description: "Scroll an element in a direction by pages without moving the user's real cursor. Shows the fake software cursor at the scroll target by default.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string" },
          element_index: { type: "string" },
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          pages: { type: "number", default: 1 },
          showFakeCursor: {
            type: "boolean",
            description: "Whether to show the fake cursor overlay while scrolling. Defaults to true.",
          },
          style: {
            type: "string",
            enum: ["fog", "lens", "software"],
            description: "Virtual cursor style. Defaults to software, using the extracted macOS Computer Use cursor asset.",
          },
        },
        required: ["app", "element_index", "direction"],
      },
    },
    {
      name: "drag",
      description: "Drag from one point to another using screen coordinates without moving the user's real cursor. Shows and animates the fake software cursor by default.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string" },
          from_x: { type: "number" },
          from_y: { type: "number" },
          to_x: { type: "number" },
          to_y: { type: "number" },
          showFakeCursor: {
            type: "boolean",
            description: "Whether to show the fake cursor overlay while dragging. Defaults to true.",
          },
          style: {
            type: "string",
            enum: ["fog", "lens", "software"],
            description: "Virtual cursor style. Defaults to software, using the extracted macOS Computer Use cursor asset.",
          },
        },
        required: ["app", "from_x", "from_y", "to_x", "to_y"],
      },
    },
    {
      name: "press_key",
      description: "Focus and verify the target app, then press a key or key-combination. Returns appDisplay and presentation metadata for app-scoped UI rendering.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string" },
          key: { type: "string" },
        },
        required: ["app", "key"],
      },
    },
    {
      name: "type_text",
      description: "Focus and verify the target app, then type literal text. Returns appDisplay and presentation metadata for app-scoped UI rendering.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string" },
          text: { type: "string" },
        },
        required: ["app", "text"],
      },
    },
    {
      name: "set_value",
      description: "Set the value of a settable UI Automation element.",
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string" },
          element_index: { type: "string" },
          value: { type: "string" },
        },
        required: ["app", "element_index", "value"],
      },
    },
    {
      name: "move_cursor",
      description: "Focus an app when provided, then move only the fake cursor overlay by default. Use compact target screen=[x,y] centers from target dumps for screen coordinates, or pass app plus coordinateSpace='window'/'screenshot' when using screenshot/window-relative coordinates. Shows the fake software cursor by default.",
      inputSchema: {
        type: "object",
        properties: {
          app: {
            type: "string",
            description: "Optional app name used to resolve window/screenshot-relative coordinates.",
          },
          x: { type: "number" },
          y: { type: "number" },
          coordinateSpace: {
            type: "string",
            enum: ["auto", "screen", "window", "screenshot"],
            description: "Coordinate space for x/y. Defaults to auto; screen is absolute desktop pixels, window/screenshot adds the target window offset.",
          },
          showFakeCursor: {
            type: "boolean",
            description: "Whether to show the fake cursor overlay. Defaults to true.",
          },
          style: {
            type: "string",
            enum: ["fog", "lens", "software"],
            description: "Virtual cursor style. Defaults to software, using the extracted macOS Computer Use cursor asset.",
          },
          isPressed: { type: "boolean" },
        },
        required: ["x", "y"],
      },
    },
    {
      name: "show_fake_cursor",
      description: "Show the Windows virtual cursor overlay. Defaults to the extracted macOS Computer Use software cursor asset.",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          style: {
            type: "string",
            enum: ["fog", "lens", "software"],
            description: "Virtual cursor style. Defaults to software; fog/lens are experimental alternates.",
          },
          isPressed: { type: "boolean" },
        },
      },
    },
    {
      name: "hide_fake_cursor",
      description: "Disable the draft virtual cursor state.",
      inputSchema: emptySchema(),
    },
  ];
}

function emptySchema() {
  return { type: "object", properties: {} };
}

async function status() {
  const base = {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    platform: process.platform,
    supported: process.platform === "win32",
    implementation: "powershell-uia-draft",
    bridgeScript: WINDOWS_BRIDGE,
    actionBridge: process.platform === "win32" ? "enabled" : "windows-only",
    capabilities: [
      "visible app listing",
      "setup diagnostics",
      "window screenshot",
      "Windows UI Automation tree dump",
      "flattened actionable element dumps with positions",
      "virtual cursor overlay movement",
      "UIA/window-message click dispatch without moving the user's cursor",
      "mouse drag",
      "scroll wheel",
      "key press",
      "text input",
      "persistent virtual cursor overlay using the extracted macOS Computer Use cursor asset",
    ],
    instructionFiles: appInstructionCatalog().files,
    warmup: {
      started: bridgeWarmupStarted,
      startedAt: bridgeWarmupStartedAt || null,
      completedAt: bridgeWarmupCompletedAt || null,
      error: bridgeWarmupError,
    },
  };
  if (process.env.WINDOWS_COMPUTER_USE_DRY_RUN === "1") return base;
  try {
    if (process.platform === "win32") {
      base.bridge = await runBridge("status", {});
    }
  } catch (error) {
    base.bridgeError = error instanceof Error ? error.message : String(error);
  }
  return base;
}

async function setupCheck() {
  if (process.env.WINDOWS_COMPUTER_USE_DRY_RUN === "1") {
    return {
      toolName: "windows_computer_use_setup_check",
      status: "dry-run",
      platform: process.platform,
      supported: process.platform === "win32",
      dryRun: true,
      message: "Setup diagnostics skipped because WINDOWS_COMPUTER_USE_DRY_RUN=1.",
      localChecks: {
        bridgeScriptExists: fs.existsSync(WINDOWS_BRIDGE),
        appInstructions: appInstructionCatalog().files.length,
      },
    };
  }
  if (process.platform !== "win32") {
    return {
      toolName: "windows_computer_use_setup_check",
      status: "unsupported-platform",
      platform: process.platform,
      supported: false,
      message: "Windows Computer Use setup checks must run on Windows. This host can only inspect the MCP schema and bundled files.",
      localChecks: {
        bridgeScriptExists: fs.existsSync(WINDOWS_BRIDGE),
        appInstructions: appInstructionCatalog().files.length,
      },
    };
  }
  return runBridge("setup-check", {});
}

async function bridgeOrUnsupported(bridgeCommand, toolName, args, required = []) {
  for (const key of required) {
    if (args?.[key] == null || String(args[key]).trim() === "") {
      throw new Error(`${key} is required`);
    }
  }
  if (process.platform !== "win32") {
    return unsupported(toolName, args);
  }
  return runBridge(bridgeCommand, args || {});
}

async function listApps(args = {}) {
  if (process.platform !== "win32") return unsupported("list_apps", args);
  if (args.detailed === true || args.includeIconData === true || args.source === "uia") {
    return runBridge("list-apps", args || {});
  }
  const cached = getFastAppsCache(args);
  if (cached) return cached;
  try {
    return await listAppsFast();
  } catch (error) {
    if (args.noFallback === true) throw error;
    return runBridge("list-apps", args || {});
  }
}

function listAppsFast() {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    execFile(
      "tasklist.exe",
      ["/v", "/fo", "csv", "/nh"],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message || "tasklist failed").trim()));
          return;
        }
        const rows = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map(parseCsvLine)
          .filter((row) => row.length >= 9);

        const appCandidates = rows
          .map((row) => {
            const imageName = row[0] || "";
            const processName = imageName.replace(/\.exe$/i, "");
            const pid = Number(row[1]);
            const title = row[8] || "";
            return {
              name: processName,
              pid,
              title,
              path: null,
              handle: null,
              source: "tasklist",
              display: {
                name: displayNameForProcess(processName, title),
                processName,
                pid,
                windowTitle: title,
                executablePath: null,
                handle: null,
                icon: null,
              },
            };
          })
          .filter((app) =>
            Number.isFinite(app.pid) &&
            app.title &&
            app.title !== "N/A" &&
            app.title !== "n/a" &&
            isLikelyUserWindow(app.name, app.title),
          )
          .sort((a, b) => a.display.name.localeCompare(b.display.name));
        const apps = dedupeApps(appCandidates);

        const result = {
          apps,
          scan: {
            source: "tasklist",
            fast: true,
            detailed: false,
            elapsedMs: Date.now() - startedAt,
          },
        };
        fastAppsCache = {
          createdAt: Date.now(),
          result,
        };
        resolve(result);
      },
    );
  });
}

function dedupeApps(apps) {
  const byKey = new Map();
  for (const app of apps) {
    const key = `${String(app.display?.name || app.name).toLowerCase()}\n${String(app.title || "").toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || appScore(app) > appScore(existing)) {
      byKey.set(key, app);
    }
  }
  return [...byKey.values()];
}

function appScore(app) {
  const proc = String(app.name || "").toLowerCase();
  if (proc === "applicationframehost") return 1;
  if (proc === "systemsettings") return 3;
  return 2;
}

function primeFastAppsCache() {
  if (process.platform !== "win32") return;
  if (fastAppsCache?.pending) return;
  const pending = listAppsFast().catch(() => null);
  fastAppsCache = {
    createdAt: Date.now(),
    pending,
    result: fastAppsCache?.result || null,
  };
}

function startComputerUse(args = {}) {
  const warmup = warmBridgeInBackground({ immediate: true });
  return {
    status: "starting",
    name: "Computer Use",
    platform: process.platform,
    supported: process.platform === "win32",
    reason: args.reason || null,
    warmupStarted: Boolean(warmup),
    warmupStartedAt: bridgeWarmupStartedAt || null,
    presentation: {
      appName: "Computer Use",
      processName: "windows-computer-use",
      iconPath: fs.existsSync(COMPUTER_USE_ICON) ? COMPUTER_USE_ICON : null,
      action: "start_computer_use",
      summary: process.platform === "win32"
        ? "Starting Computer Use"
        : "Starting Computer Use is only available on Windows",
    },
  };
}

function warmBridgeInBackground(options = {}) {
  if (process.platform !== "win32") return null;
  if (process.env.WINDOWS_COMPUTER_USE_DRY_RUN === "1") return null;
  if (process.env.WINDOWS_COMPUTER_USE_PREWARM_BRIDGE === "0") return null;
  if (bridgeWarmupStarted && bridgeProcess && bridgeProcess.exitCode == null) return bridgeProcess;

  bridgeWarmupStarted = true;
  bridgeWarmupStartedAt = Date.now();
  bridgeWarmupError = null;

  const delayMs = options.immediate
    ? 0
    : Math.max(0, Number(process.env.WINDOWS_COMPUTER_USE_PREWARM_DELAY_MS || 250));

  setTimeout(() => {
    runBridge("warmup", {})
      .then(() => {
        bridgeWarmupCompletedAt = Date.now();
      })
      .catch((error) => {
        bridgeWarmupError = error instanceof Error ? error.message : String(error);
      });
  }, delayMs);

  return bridgeProcess || true;
}

function getFastAppsCache(args = {}) {
  if (args.noCache === true) return null;
  if (!fastAppsCache?.result) return null;
  const maxAgeMs = Number(args.cacheMaxAgeMs || 5000);
  if (Date.now() - fastAppsCache.createdAt > maxAgeMs) return null;
  return {
    ...fastAppsCache.result,
    scan: {
      ...fastAppsCache.result.scan,
      cached: true,
      cacheAgeMs: Date.now() - fastAppsCache.createdAt,
    },
  };
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (quoted && line[i + 1] === "\"") {
        value += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function isLikelyUserWindow(processName, title) {
  const proc = String(processName || "").toLowerCase();
  const windowTitle = String(title || "").trim();
  const lowerTitle = windowTitle.toLowerCase();

  const hiddenTitlePatterns = [
    /^ole(mainthreadwndname|channelwnd)$/i,
    /^dde server window$/i,
    /^default ime$/i,
    /^gdi\+ window/i,
    /^ms_webcheckmonitor/i,
    /^crossdeviceresumewindow$/i,
    /^dwm notification window$/i,
    /^task host window$/i,
    /^dummy/i,
    /^hidden/i,
  ];
  if (hiddenTitlePatterns.some((pattern) => pattern.test(windowTitle))) return false;

  const hiddenProcesses = new Set([
    "appactions",
    "backgroundtaskhost",
    "crossdeviceresume",
    "ctfmon",
    "dllhost",
    "dwm",
    "onedrive.sync.service",
    "runtimebroker",
    "searchhost",
    "shellexperiencehost",
    "shellhost",
    "sihost",
    "startmenuexperiencehost",
    "svchost",
    "textinputhost",
    "widgets",
    "windowsterminal",
  ]);
  if (hiddenProcesses.has(proc)) return false;

  const allowedProcesses = new Set([
    "applicationframehost",
    "calculatorapp",
    "codex",
    "code",
    "devenv",
    "explorer",
    "mspaint",
    "msedge",
    "notepad",
    "powershell",
    "pwsh",
    "systemsettings",
    "taskmgr",
    "wt",
  ]);
  if (allowedProcesses.has(proc)) return true;

  return (
    windowTitle.length > 2 &&
    !lowerTitle.includes("olemainthread") &&
    !lowerTitle.includes("olechannel")
  );
}

function displayNameForProcess(processName, title) {
  const lower = String(processName || "").toLowerCase();
  const titleText = String(title || "");
  const known = {
    applicationframehost: titleText || "Application Frame Host",
    codex: "Codex",
    msedge: "Microsoft Edge",
    systemsettings: "Settings",
    textinputhost: "Windows Input Experience",
    notepad: "Notepad",
    explorer: "File Explorer",
    taskmgr: "Task Manager",
    code: "Visual Studio Code",
    devenv: "Visual Studio",
    powershell: "PowerShell",
    pwsh: "PowerShell",
    wt: "Windows Terminal",
    mspaint: "Paint",
    calculatorapp: "Calculator",
  };
  return known[lower] || processName || titleText || "App";
}

async function bridgeOrDryRun(bridgeCommand, toolName, args) {
  if (process.env.WINDOWS_COMPUTER_USE_DRY_RUN === "1") {
    return {
      toolName,
      dryRun: true,
      args,
    };
  }
  if (process.platform !== "win32") {
    return unsupported(toolName, args);
  }
  return runBridge(bridgeCommand, args || {});
}

function unsupported(toolName, extra = {}) {
  return {
    toolName,
    status: "unsupported-platform",
    platform: process.platform,
    supported: false,
    message: "Windows Computer Use runs its real bridge on win32. This host can only inspect schemas and draft metadata.",
    ...extra,
  };
}

function appInstructionCatalog() {
  const files = fs.existsSync(APP_INSTRUCTIONS_DIR)
    ? fs.readdirSync(APP_INSTRUCTIONS_DIR).filter((name) => name.endsWith(".md")).sort()
    : [];
  return {
    directory: APP_INSTRUCTIONS_DIR,
    files: files.map((name) => {
      const fullPath = path.join(APP_INSTRUCTIONS_DIR, name);
      return {
        name,
        path: fullPath,
        bytes: fs.statSync(fullPath).size,
      };
    }),
  };
}

function withAppSpecificInstructions(result, args = {}) {
  if (!result || typeof result !== "object" || result.status !== "found") return result;
  const instruction = findAppInstruction(result, args);
  if (!instruction) return result;
  return {
    ...result,
    appSpecificInstructions: instruction,
  };
}

function findAppInstruction(result, args = {}) {
  const candidates = [
    args.app,
    result.appDisplay?.name,
    result.appDisplay?.processName,
    result.appDisplay?.windowTitle,
    result.window?.name,
    result.window?.title,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  const aliases = [
    { file: "Edge.md", patterns: ["edge", "msedge", "microsoft edge", "browser", "youtube music", "music.youtube.com"] },
    { file: "VS Code.md", patterns: ["code", "visual studio code", "vscode"] },
    { file: "Visual Studio.md", patterns: ["visual studio", "devenv"] },
    { file: "Windows Terminal.md", patterns: ["windows terminal", "terminal", "wt"] },
    { file: "PowerShell.md", patterns: ["powershell", "pwsh"] },
    { file: "File Explorer.md", patterns: ["explorer", "file explorer"] },
    { file: "Task Manager.md", patterns: ["task manager", "taskmgr"] },
    { file: "Calculator.md", patterns: ["calculator", "applicationframehost"] },
    { file: "Notepad.md", patterns: ["notepad"] },
    { file: "Paint.md", patterns: ["paint", "mspaint"] },
    { file: "Settings.md", patterns: ["settings", "systemsettings"] },
  ];

  const match = aliases.find((entry) =>
    entry.patterns.some((pattern) => candidates.some((candidate) => candidate.includes(pattern))),
  );
  if (!match) return null;

  const fullPath = path.join(APP_INSTRUCTIONS_DIR, match.file);
  if (!fs.existsSync(fullPath)) return null;
  return {
    name: match.file,
    path: fullPath,
    markdown: fs.readFileSync(fullPath, "utf8"),
  };
}

function runBridge(command, payload) {
  if (process.platform === "win32" && process.env.WINDOWS_COMPUTER_USE_BRIDGE_DAEMON !== "0") {
    return runDaemonBridge(command, payload).catch((error) => {
      if (process.env.WINDOWS_COMPUTER_USE_BRIDGE_DEBUG === "1") {
        process.stderr.write(`Windows bridge daemon unavailable: ${error.message}\n`);
      }
      return runFallbackBridge(command, payload);
    });
  }
  return runFallbackBridge(command, payload);
}

function runFallbackBridge(command, payload) {
  if (process.platform === "win32" && process.env.WINDOWS_COMPUTER_USE_PERSISTENT_BRIDGE !== "0") {
    return runPersistentBridge(command, payload);
  }
  return runOneShotBridge(command, payload);
}

function runDaemonBridge(command, payload) {
  return new Promise((resolve, reject) => {
    const id = bridgeNextId++;
    const socket = net.createConnection(BRIDGE_PIPE);
    let buffer = "";
    let settled = false;

    const timeout = setTimeout(() => {
      fail(new Error(`Timed out waiting for Windows bridge daemon command: ${command}`));
    }, Math.max(15000, Number(process.env.WINDOWS_COMPUTER_USE_BRIDGE_TIMEOUT_MS || 45000)));

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    }

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.end();
      resolve(value);
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id, command, payload: payload || {} })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = parseJson(line);
        if (message?.id !== id) continue;
        if (message.ok) {
          finish(message.result);
        } else {
          fail(new Error(message?.error || "Windows bridge daemon command failed"));
        }
      }
    });
    socket.on("error", fail);
    socket.on("close", () => {
      if (!settled) fail(new Error("Windows bridge daemon closed before replying."));
    });
  });
}

function runOneShotBridge(command, payload) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        WINDOWS_BRIDGE,
        "-Command",
        command,
        "-Payload",
        JSON.stringify(payload || {}),
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message || "PowerShell failed").trim()));
          return;
        }
        resolve(parseJson(stdout.trim()));
      },
    );
  });
}

function runPersistentBridge(command, payload) {
  const proc = ensureBridgeProcess();
  const id = bridgeNextId++;
  const body = JSON.stringify({ id, command, payload: payload || {} });
  proc.stdin.write(`${body}\n`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bridgePending.delete(id);
      reject(new Error(`Timed out waiting for Windows bridge command: ${command}`));
    }, Math.max(15000, Number(process.env.WINDOWS_COMPUTER_USE_BRIDGE_TIMEOUT_MS || 45000)));
    bridgePending.set(id, { resolve, reject, timeout });
  });
}

function ensureBridgeProcess() {
  if (bridgeProcess && !bridgeProcess.killed && bridgeProcess.exitCode == null) {
    return bridgeProcess;
  }

  bridgeBuffer = "";
  bridgeProcess = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WINDOWS_BRIDGE,
      "-Server",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  bridgeProcess.stdout.setEncoding("utf8");
  bridgeProcess.stdout.on("data", handleBridgeStdout);
  bridgeProcess.stderr.on("data", (chunk) => {
    if (process.env.WINDOWS_COMPUTER_USE_BRIDGE_DEBUG === "1") {
      process.stderr.write(chunk);
    }
  });
  bridgeProcess.on("exit", (code, signal) => {
    const error = new Error(`Windows bridge exited (${signal || (code ?? "unknown")})`);
    for (const [id, pending] of bridgePending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      bridgePending.delete(id);
    }
    bridgeProcess = null;
  });
  return bridgeProcess;
}

function handleBridgeStdout(chunk) {
  bridgeBuffer += chunk;
  let newline;
  while ((newline = bridgeBuffer.indexOf("\n")) >= 0) {
    const line = bridgeBuffer.slice(0, newline).trim();
    bridgeBuffer = bridgeBuffer.slice(newline + 1);
    if (!line) continue;

    const message = parseJson(line);
    if (message?.type === "ready") continue;
    const pending = bridgePending.get(message?.id);
    if (!pending) continue;
    bridgePending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error || "Windows bridge command failed"));
    }
  }
}

process.on("exit", () => {
  if (bridgeProcess && bridgeProcess.exitCode == null) {
    bridgeProcess.kill();
  }
});

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function content(value, args = {}) {
  const includeStructuredContent = args?.includeStructuredContent === true || args?.debug === true;

  if (value?.status === "ok" && value.visible === false && value.stopped === true) {
    return {
      content: [],
      _meta: { hidden: true, raw: value },
    };
  }

  if (value?.presentation?.summary) {
    const lines = [
      value.presentation.summary,
      value.presentation.appName ? `App: ${value.presentation.appName}` : null,
      value.presentation.iconPath ? `Icon: ${value.presentation.iconPath}` : null,
      value.focus?.verifiedBeforeSend ? `Focus verified before send: pid ${value.focus.targetPid}` : null,
    ].filter(Boolean);

    const result = {
      content: [{
        type: "text",
        text: lines.join("\n"),
      }],
      _meta: {
        presentation: value.presentation,
        appDisplay: value.appDisplay,
        raw: value,
      },
    };
    if (includeStructuredContent) result.structuredContent = value;
    return result;
  }

  if (Array.isArray(value?.apps)) {
    const result = {
      content: [{
        type: "text",
        text: formatApps(value.apps),
      }],
      _meta: { raw: value },
    };
    if (includeStructuredContent) result.structuredContent = value;
    return result;
  }

  if (value?.status === "found" && value?.screenshot && Array.isArray(value?.accessibilityTree)) {
    const result = {
      content: [{
        type: "text",
        text: formatAppState(value),
      }],
      _meta: {
        appDisplay: value.appDisplay,
        screenshot: value.screenshot,
        raw: value,
      },
    };
    if (includeStructuredContent) result.structuredContent = value;
    return result;
  }

  if (value?.status === "found" && Array.isArray(value?.targets)) {
    const result = {
      content: [{
        type: "text",
        text: formatTargetDump(value),
      }],
      _meta: {
        appDisplay: value.appDisplay,
        raw: value,
      },
    };
    if (includeStructuredContent) result.structuredContent = value;
    return result;
  }

  return {
    content: [{
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }],
  };
}

function formatApps(apps) {
  if (!apps.length) return "No visible Windows apps.";
  return [
    `Visible apps (${apps.length})`,
    ...apps.map((app, index) => {
      const display = app.display || {};
      const iconPath = display.icon?.path ? ` icon=${display.icon.path}` : "";
      return `${index}. ${display.name || app.name} (${app.name} pid=${app.pid}) hwnd=${app.handle} title="${app.title || ""}"${iconPath}`;
    }),
  ].join("\n");
}

function formatAppState(state) {
  const app = state.appDisplay || {};
  const win = state.window || {};
  const shot = state.screenshot || {};
  const rect = win.rect || {};
  const origin = shot.screenOrigin || {};
  const lines = [
    `${app.name || win.name || state.app} (${app.processName || win.name || state.app} pid=${app.pid || win.pid || "?"})`,
    `title: ${app.windowTitle || win.title || ""}`,
    app.icon?.path ? `icon: ${app.icon.path}` : null,
    `window: hwnd=${win.handle || app.handle || "?"} screen=${rect.x ?? rect.left ?? "?"},${rect.y ?? rect.top ?? "?"} ${rect.width ?? "?"}x${rect.height ?? "?"}`,
    shot.path ? `screenshot: ${shot.path} ${shot.width}x${shot.height} ${shot.coordinateSpace || ""} origin=${origin.x ?? "?"},${origin.y ?? "?"}` : null,
    "",
    `tree (${state.scan?.treeFormat || "unknown"}):`,
    ...arrayLines(state.accessibilityTree),
  ].filter((line) => line !== null);

  if (Array.isArray(state.actionableElements) && state.actionableElements.length) {
    lines.push("", `targets (${state.actionableElements.length}/${state.scan?.actionableCount ?? state.actionableElements.length}):`);
    for (const target of state.actionableElements) {
      lines.push(formatTarget(target));
    }
  }

  if (state.appSpecificInstructions?.name) {
    lines.push("", `instructions: ${state.appSpecificInstructions.name}`);
    const markdown = String(state.appSpecificInstructions.markdown || "").trim();
    if (markdown) lines.push(markdown);
  }

  return lines.join("\n");
}

function formatTargetDump(result) {
  const app = result.appDisplay || {};
  const lines = [
    `${app.name || result.app} targets (${result.targetCount || result.targets.length})`,
    result.window?.title ? `title: ${result.window.title}` : null,
    app.icon?.path ? `icon: ${app.icon.path}` : null,
    "",
    ...result.targets.map(formatTarget),
  ].filter((line) => line !== null);
  return lines.join("\n");
}

function formatTarget(target) {
  const screen = Array.isArray(target.screen) ? target.screen.join(",") : "";
  const windowPoint = Array.isArray(target.window) ? target.window.join(",") : "";
  const rect = Array.isArray(target.rect) ? target.rect.join(",") : "";
  const actions = Array.isArray(target.actions) && target.actions.length ? ` actions=${target.actions.join("|")}` : "";
  const label = target.label ? ` "${target.label}"` : "";
  const meta = target.meta ? ` ${target.meta}` : "";
  return `- ${target.i} ${target.role}${label} tool=${target.tool} screen=${screen} window=${windowPoint} rect=${rect}${actions}${meta}`;
}

function arrayLines(value) {
  return Array.isArray(value) ? value.map((line) => String(line)) : [];
}

function respond(message) {
  const body = JSON.stringify(message);
  if (process.env.MCP_CONTENT_LENGTH === "1") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  } else {
    process.stdout.write(`${body}\n`);
  }
}
