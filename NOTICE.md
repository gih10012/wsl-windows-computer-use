# Upstream attribution

The backend in `plugins/windows-desktop/backend/` is adapted from
[b-nnett/codex-plusplus-windows-computer-use](https://github.com/b-nnett/codex-plusplus-windows-computer-use),
commit `1bb59c73f16f2ec3c3797168163d48d759eac706`. Its `package.json`
declares the MIT license and its plugin manifest credits Bennett. Copyright
in those portions remains with Bennett and the upstream contributors.

This copy adds physical-pixel DPI handling, verified window focus and
targeting, native pointer movement and drag, Unicode paste with clipboard
restoration, target-window capture, title checks, and normal window closing.
The MCP adapter and Codex plugin wrapper are maintained here.

The optional upstream macOS-style cursor assets are not bundled or exposed.
