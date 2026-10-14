## PowerShell Computer Use

### Prompt Awareness

Read the visible prompt and current command line before typing. PowerShell, Windows PowerShell, elevated sessions, remoting sessions, and profile prompts can behave differently.

### Command Entry

Use `type_text` for literal commands and `press_key` with `Enter` to submit. Use pasted here-strings only when the user explicitly wants multi-line shell input.

### Output

After running a command, call `get_app_state` again and inspect the terminal text before deciding whether it succeeded. Do not infer success from a returned prompt alone if the output contains errors.

### Safety

Avoid destructive commands, execution-policy changes, credential prompts, registry edits, and package installs unless the user explicitly requested them.

### Localization

Prefer prompt shape, command text, command output, control type, and terminal structure over English labels. PowerShell errors and prompts can be localized.
