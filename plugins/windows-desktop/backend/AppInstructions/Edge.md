## Microsoft Edge Computer Use

### Navigation

Prefer address bar navigation with <ctrl+l>, type the URL or search text, then press <Enter>.

### Page Interaction

Use `get_app_state` after navigation before clicking. Web pages can shift while loading, so avoid coordinate clicks until the accessibility tree and screenshot agree. Prefer target `screenCenter` values for browser chrome and page controls. If using screenshot coordinates, pass `coordinateSpace: "screenshot"` so the bridge accounts for the Edge window offset.

### Downloads

When a download prompt appears, use the visible download shelf or toolbar controls instead of guessing a filesystem path. Confirm the downloaded file through the browser UI before reporting completion.

### Localization

Prefer AutomationId, control type, keyboard shortcuts, URL state, and page structure over English browser labels. Browser chrome and web content can be localized independently.
