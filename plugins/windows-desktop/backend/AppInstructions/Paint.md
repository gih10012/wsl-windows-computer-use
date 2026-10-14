## Paint Computer Use

### Canvas

Paint has a large drawing canvas that may not expose detailed UI Automation children. Use `get_app_state` and screenshots to confirm canvas position before coordinate-based drawing.

### Tools

Prefer toolbar and ribbon targets from `dump_app_targets` for tool selection, color selection, text insertion, zoom, save, and undo. Re-query after opening menus or flyouts.

### Drawing

For drawing gestures, use screenshot coordinates relative to the visible canvas and keep movements simple. Verify the result with a fresh screenshot.

### Localization

Do not rely on English ribbon labels. Prefer AutomationId, control type, supported patterns, and spatial grouping.
