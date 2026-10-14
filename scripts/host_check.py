#!/usr/bin/env python3
"""Check the installed plugin through Codex app-server, without model inference."""
import argparse
import base64
import json
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", default="list_apps")
    parser.add_argument("--args", default="{}")
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts/host-check.json")
    options = parser.parse_args()
    options.report.parent.mkdir(exist_ok=True, parents=True)
    report = {"passed": False, "inference_started": False}
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(["codex", "app-server", "--stdio"], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1)
        messages = queue.Queue()
        def receive():
            for line in process.stdout:
                messages.put(json.loads(line))
            messages.put(None)
        threading.Thread(target=receive, daemon=True).start()
        counter = 0
        def request(method, params):
            nonlocal counter
            counter += 1
            process.stdin.write(json.dumps({"id": counter, "method": method, "params": params}) + "\n")
            process.stdin.flush()
            deadline = time.monotonic() + 55
            while time.monotonic() < deadline:
                response = messages.get(timeout=max(0.01, deadline - time.monotonic()))
                if response is None:
                    raise RuntimeError("Codex app-server exited")
                if response.get("id") == counter:
                    if "error" in response:
                        raise RuntimeError(response["error"])
                    return response["result"]
            raise TimeoutError(method)
        try:
            request("initialize", {"clientInfo": {"name": "windows-desktop-host-check", "version": "0.1.0"},
                                   "capabilities": {"experimentalApi": True}})
            process.stdin.write(json.dumps({"method": "initialized"}) + "\n")
            process.stdin.flush()
            plugin = request("plugin/read", {"pluginName": "windows-desktop",
                                             "marketplacePath": str(ROOT / ".agents/plugins/marketplace.json")})
            if not plugin["plugin"]["mcpServers"]:
                raise RuntimeError("Installed plugin has no MCP server")
            print(json.dumps({"plugin_mcp_config": plugin["plugin"]["mcpServers"]}, ensure_ascii=False), flush=True)
            thread = request("thread/start", {"cwd": str(ROOT), "ephemeral": True})
            thread_id = thread["thread"]["id"]
            deadline = time.monotonic() + 35
            while True:
                status = request("mcpServerStatus/list", {"threadId": thread_id, "detail": "toolsAndAuthOnly", "limit": 100})
                servers = [s for s in status["data"] if "windows_desktop" in s["name"]]
                if servers and servers[0]["tools"]:
                    break
                if servers and servers[0].get("runtimeStatus") == "failed":
                    raise RuntimeError({"desktop_server": servers})
                if time.monotonic() >= deadline:
                    raise RuntimeError({"desktop_server": servers, "available_servers": [s["name"] for s in status["data"]]})
                time.sleep(0.5)
            server = servers[0]
            names = list(server["tools"]) if isinstance(server["tools"], dict) else [t["name"] for t in server["tools"]]
            required = {"get_app_state", "list_apps", "move_mouse", "drag", "type_text", "batch", "close_window"}
            if not required.issubset(set(names)):
                raise RuntimeError({"missing_tools": sorted(required - set(names))})
            print(json.dumps({"server": server["name"], "tool_count": len(names)}, ensure_ascii=False), flush=True)
            result = request("mcpServer/tool/call", {"threadId": thread_id, "server": server["name"],
                                                    "tool": options.tool, "arguments": json.loads(options.args)})
            images = []
            for index, block in enumerate(result.get("content", [])):
                if block.get("type") == "image":
                    filename = options.report.parent / f"host-{options.tool}-{time.time_ns()}-{index}.png"
                    filename.write_bytes(base64.b64decode(block["data"]))
                    images.append(str(filename))
                    block.clear()
                    block.update(type="image_saved", path=str(filename))
            report.update(passed=not result.get("isError", False), server=server["name"], tools=sorted(names),
                          called_tool=options.tool, images=images, result=result)
            summary = {"passed": report["passed"], "tool": options.tool, "images": images,
                       "status": result.get("structuredContent", {}).get("status"),
                       "window": result.get("structuredContent", {}).get("window"),
                       "completedCount": result.get("structuredContent", {}).get("completedCount"),
                       "failure": result.get("structuredContent", {}).get("failure")}
            if options.tool == "list_apps":
                summary["apps"] = [{"name": item.get("name"), "pid": item.get("pid"), "title": item.get("title")}
                                   for item in result.get("structuredContent", {}).get("apps", [])]
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            if not report["passed"]:
                raise RuntimeError("MCP tool reported an error; completed inputs were not retried")
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
            options.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            if not report["passed"]:
                log.seek(0)
                for line in log.read().decode(errors="replace").splitlines():
                    if any(fragment in line for fragment in ("MCP startup failed", "Cannot find module", "mcp-server.cjs")):
                        print(line[-900:])


if __name__ == "__main__":
    main()
