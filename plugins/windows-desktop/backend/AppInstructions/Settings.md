## Windows Settings Computer Use

### Search First

Prefer Settings search for deep pages. Focus the search box, type the requested setting, then inspect `dump_app_targets` for the resulting page or suggestion list.

### Toggles and Pickers

For switches, checkboxes, combo boxes, and radio buttons, prefer UI Automation patterns such as `Toggle`, `SelectionItem`, `ExpandCollapse`, and `Value`. Avoid assuming that the visible text will be English.

### Navigation

Use the breadcrumb, Back button, or search results rather than coordinate clicks in the left navigation. Re-query with `get_app_state` after every page transition.

### Safety

Treat account, privacy, security, network reset, device removal, and recovery settings as high-impact. Read the current page and confirmation dialogs before taking action.
