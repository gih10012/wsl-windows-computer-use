## Notepad Computer Use

### Text Entry

Notepad is the preferred baseline app for testing `type_text`, `press_key`, focus, save dialogs, and simple edit controls. Before typing, verify the editor target with `get_app_state` or click the editor area once.

### Shortcuts

Use standard keyboard shortcuts for common actions: <ctrl+n>, <ctrl+o>, <ctrl+s>, <ctrl+f>, <ctrl+h>, <ctrl+a>, <ctrl+c>, <ctrl+v>, and <ctrl+z>.

### Save Dialogs

When saving, inspect the dialog targets rather than guessing the active field. Use the file name edit control, file type combo box, and Save button from `dump_app_targets`.

### Localization

Prefer control type, supported patterns, and edit-field position over English labels. Dialog button text can vary by language.
