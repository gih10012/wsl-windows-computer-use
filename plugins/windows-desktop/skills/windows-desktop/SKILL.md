---
name: windows-desktop
description: Observe and operate this computer's visible Windows desktop applications from Windows or WSL using windows_desktop MCP tools, screenshots, accessibility controls, targeted keyboard input and Unicode text paste. Not a Linux/niri desktop backend.
---

Use the `windows_desktop` MCP server for the user's Windows GUI task. It shares
the active desktop and focus with the user. This is a third-party local bridge,
not the official ChatGPT `@Computer` service. No separate API key or ChatGPT
login is needed for this bridge.

## Observe and target

Use `windows_computer_use_status` if readiness is unknown, then `list_apps`.
Prefer an observed exact `app: "pid:N"` or `app: "hwnd:0xHEX"` over a substring.
The backend enumerates main windows; don't assume it can choose another window
belonging to the same process. Refresh after apps restart or dialogs change.
Browser tabs share a process. For every browser input, pass
`expectedWindowTitle` exactly as returned by the latest `get_app_state`; a tab
switch or title change then rejects the action. A batch targeting the browser
also needs this title. If it changes, inspect the new page before acting again.

Call `get_app_state` before acting. It normally captures the target with
PrintWindow without switching focus, and returns accessibility controls,
physical-pixel geometry and a PNG directly in
the tool result. Do not use a second screen-capture mechanism. If the tree lacks
editable/clickable controls, use the fresh screenshot; don't invent indices.
`include_screenshot: false` omits the image payload when geometry/tree suffice.
`dump_app_targets` provides detailed UIA targets.

For a screenshot point, pass x/y with `coordinateSpace: "screenshot"` and the
exact app. No additional 125%/150% display-scale conversion is required.
Explicit screen coordinates require `coordinateSpace: "screen"`. App-scoped
clicks reject unrelated overlapping windows rather than clicking through them.

## Input and Chinese IME

Prefer `set_value` for a currently observed writable UIA element. Otherwise
click the observed text field and call `type_text`. This tool uses Unicode
clipboard paste and restores the previous clipboard formats; it does not type
Latin characters through the Chinese IME or change the user's global language.
If an IME candidate/composition is visibly active, dismiss it in that target
field with `press_key("Escape")` before replacing text. For replacement, focus
the correct field, use Ctrl+A, then `type_text`. Check the actual value for
spaces, punctuation, Chinese text and composition candidates afterwards.
Do not retry a failed input blindly: it might already have been delivered.

`press_key` handles Windows shortcuts such as Ctrl+L, Enter and Alt+F4. It checks
foreground ownership before sending. A focus/clipboard refusal is a reason to
inspect fresh state, not remove the guard. Text paste requires the destination
to support Ctrl+V; secure/password fields and custom controls may not.
Clipboard changes from another app during paste are left intact.

The optional software-cursor overlay is disabled and not exposed. `move_mouse`
moves the real pointer; coordinate clicks, drag and scroll use Windows native
input by default. UIA element clicks may invoke the control directly.
`batch(app, actions)` runs up to 32 already-grounded actions sequentially and
stops at the first error, reporting any completed actions. Do not batch blind
coordinates across navigation or layout changes; inspect the intermediate
state instead. `close_window` sends a normal close request to an exact target;
it does not kill the process or approve discarding unsaved changes.
Locked desktops and UAC/security prompts are
not supported. Do not switch desktops or bypass such prompts.

## Verify

After a meaningful action, inspect `get_app_state` or `screenshot_window` and
the visible/result state. A delivered event is not proof of success. Keep
desktop actions within the user's task; don't restart apps with unsaved work.
Track which windows you opened specifically for testing or temporary work.
Close those windows when finished or cancelled, using their exact observed
target and normal close behavior. Do not close the user's pre-existing windows,
or discard unsaved work. A verification window should not remain on the desktop
after its result has been recorded.
If these tools aren't in the current session's tool list, a new/resumed Codex
session must load the installed plugin. Do not claim shell-based diagnostics
are already hot-loaded tools.
