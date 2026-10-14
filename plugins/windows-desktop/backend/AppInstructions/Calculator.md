## Calculator Computer Use

### Button Testing

Calculator is a good baseline for `dump_app_targets` because most actions are buttons with stable screen and window-relative centers. Prefer clicking by `element_index` from the target dump.

### Entry

Use button targets for arithmetic-flow tests and keyboard input for text-entry tests. Re-query after changing modes because the visible keypad and memory controls can change.

### Verification

Read the display from `get_app_state` after each calculation. Do not infer the result from submitted inputs alone.

### Localization

Prefer AutomationId, control type, and button position. Digit and operator labels may vary by locale or display direction.
