## File Explorer Computer Use

### Navigation

Prefer the address bar with <ctrl+l> for direct paths, known folders, and shell locations. After navigation, call `get_app_state` or `dump_app_targets` before selecting files because Explorer can refresh the item view asynchronously.

### Selection

Use the UI Automation list/grid item targets when available. Prefer `element_index` clicks over coordinates for files, folders, toolbar buttons, breadcrumbs, and navigation pane items.

### File Operations

For rename, copy, move, delete, and properties, use keyboard accelerators or context-menu targets only after the selected item is visible in the current state dump. Confirm destructive dialogs by inspecting their title and actionable buttons.

### Localization

Do not rely on English labels like "This PC", "Downloads", or "Delete". Prefer path navigation, AutomationId, control type, and element position within the active window.
