# Windows Desktop MCP for Codex and WSL

Observe and operate the visible Windows desktop from Codex on Windows or in
WSL. This project packages a local MCP server as a Codex plugin and includes
a Windows UI Automation/Win32 backend. It is separate from ChatGPT's official
`@Computer` service and does not need its login or an API key.

The MCP server exposes `list_apps`, `get_app_state`, `screenshot_window`,
`dump_app_targets`, `move_mouse`, `click`, `drag`, `scroll`, `press_key`,
`type_text`, `set_value`, `perform_secondary_action`, `batch`, `close_window`,
and `windows_computer_use_status`. Screenshots are returned as PNG image
blocks in tool results. Coordinate input uses physical pixels from the latest
screenshot. The real pointer moves for native coordinate input. Text is
pasted as Unicode and the clipboard is restored when no other app changes it.

## Install

Requirements: a logged-in interactive Windows session, Node.js on Windows,
Windows PowerShell 5.1, and Codex with local plugin support. For WSL, install
Node.js there too and enable WSL interoperability. This machine has a stale
Windows-executable registration, so the bridge launches Windows Node through
`/init` directly. The plugin expects its marketplace name to be
`windows-local` and its version to be `0.2.0` in the Codex cache.

Clone this repository to a Windows drive. From Codex on Windows, register the
folder as a local marketplace and install the plugin:

```text
codex plugin marketplace add C:\path\to\wsl-windows-computer-use
codex plugin add windows-desktop@windows-local
```

For a WSL-only installation, use the corresponding `/mnt/<drive>/...` path
with the same commands. If Windows and WSL share one `config.toml`, keep the
marketplace source in Windows form for Windows Codex; this machine's WSL
launcher translates that one source to its `/mnt/...` path at startup. Other
dual-host installations need an equivalent OS-specific path override.
Restart or resume a Codex session after installation so the MCP tools load.
In ChatGPT desktop, use the local plugin marketplace if your app supports it.

## Use

Call `list_apps` and `get_app_state` first. Target exact `pid:N` or
`hwnd:0xHEX` from the result. For browser input, pass the observed
`expectedWindowTitle`; the backend stops if the user switches tabs before an
action. A batch inherits one target and expected title, runs up to 32 grounded
actions in order, and stops at the first error. Inspect the final screenshot
and visible result before continuing. Do not batch coordinates across page
navigation, because the layout may change.

`close_window` requests normal closing of a window you opened for the task;
it does not kill a process or discard unsaved work. The installed skill under
`plugins/windows-desktop/skills/windows-desktop/` has the complete workflow.

This bridge acts only in the active user's desktop session. Elevated or
protected desktops, UAC prompts, and locked desktops are outside its scope.
GUI applications that reject native mouse input or clipboard paste may need
another control method.

## Verification

`scripts/host_check.py` opens an ephemeral Codex app-server thread and invokes
the installed MCP tool without starting a model turn:

```text
python3 scripts/host_check.py --tool list_apps
python3 scripts/host_check.py --tool get_app_state --args '{"app":"pid:1234"}'
```

The script writes local results and PNGs to ignored `artifacts/`. The small
WinForms form in `VerificationForm.cs` is an optional isolated GUI test. Its
Windows launcher is `build-verification.ps1`; close the test form when done.

## Credits

The vendored backend is adapted from the MIT-licensed project credited in
[NOTICE.md](NOTICE.md). The local plugin layout follows the same Codex
marketplace and skill pattern used by
[niri-computer-use](https://github.com/agent-sh/computer-use-linux).
