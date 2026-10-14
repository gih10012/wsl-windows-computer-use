## VS Code Computer Use

### Command Palette

Prefer <ctrl+shift+p> for commands and <ctrl+p> for file navigation. After opening a palette or quick picker, inspect `dump_app_targets` because result rows and buttons are exposed through UI Automation.

### Editing

For larger edits, use filesystem tools rather than GUI typing. Use the editor only for focus, smoke tests, and small interactions that specifically need the app UI.

### Panels

Terminal, Problems, Search, Source Control, and Extensions panels can shift focus. Re-query `get_app_state` after switching panels or opening dialogs.

### Localization

Prefer command IDs, file paths, keyboard shortcuts, control type, and AutomationId over English visible labels.
