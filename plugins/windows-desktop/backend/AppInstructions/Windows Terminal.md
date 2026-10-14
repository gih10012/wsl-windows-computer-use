## Windows Terminal Computer Use

### Shell Awareness

Check the visible prompt before typing commands. Windows Terminal may host PowerShell, Command Prompt, WSL, SSH sessions, or developer shells, and command syntax differs.

### Command Entry

Use `type_text` for commands and `press_key` with `Enter` to submit. Do not paste multi-step destructive commands without explicit user approval.

### Long Running Commands

After submitting a long-running command, call `get_app_state` again and inspect the terminal output. Do not assume completion from elapsed time alone.

### Localization

Prefer prompt text, command output, control type, tab structure, and keyboard shortcuts over English menu labels. Shell output and terminal chrome may use different languages.
