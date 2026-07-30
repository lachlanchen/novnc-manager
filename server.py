#!/usr/bin/env python3
"""Local, read-only inventory dashboard for noVNC sessions."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = APP_ROOT / "static"
CONFIG_PATH = APP_ROOT / "config.json"
VERSION = "1.0.0"
HOST_PORT_RE = re.compile(r"^(?:\[([^\]]+)\]|([^:]+)):(\d+)$")
PID_RE = re.compile(r"pid=(\d+)")
SERVICE_RE = re.compile(r"/([^/]+\.service)(?:/|$)")
GENERIC_UNITS = {"cron.service", "user@1000.service", "init.scope"}


@dataclass
class ProcessInfo:
    pid: int
    ppid: int
    command: list[str]
    cwd: str
    tmux_pane: str
    unit: str
    started_at: float

    @property
    def command_text(self) -> str:
        return " ".join(self.command)


@dataclass
class SessionInfo:
    id: str
    name: str
    purpose: str
    status: str
    http_ok: bool
    vnc_ok: bool
    web_host: str
    web_port: int
    vnc_host: str
    vnc_port: int | None
    display: str
    resolution: str
    web_pid: int
    vnc_pid: int | None
    tmux_session: str
    tmux_window: str
    service: str
    source_path: str
    source_kind: str
    source_detail: str
    command: str
    started_at: str
    uptime_seconds: int
    url: str
    preview_url: str
    priority: int


def parse_host_port(value: str) -> tuple[str, int] | None:
    match = HOST_PORT_RE.match(value)
    if not match:
        return None
    host = match.group(1) or match.group(2) or "127.0.0.1"
    return host, int(match.group(3))


def proc_stat(pid: int) -> tuple[int, float]:
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
        fields = raw[raw.rfind(")") + 2 :].split()
        ppid = int(fields[1])
        start_ticks = int(fields[19])
        boot_time = 0
        for line in Path("/proc/stat").read_text().splitlines():
            if line.startswith("btime "):
                boot_time = int(line.split()[1])
                break
        started_at = boot_time + start_ticks / os.sysconf(os.sysconf_names["SC_CLK_TCK"])
        return ppid, started_at
    except (FileNotFoundError, PermissionError, ValueError, IndexError):
        return 0, 0


def read_process(pid: int) -> ProcessInfo | None:
    proc_root = Path(f"/proc/{pid}")
    try:
        command = [
            part.decode("utf-8", errors="replace")
            for part in (proc_root / "cmdline").read_bytes().split(b"\0")
            if part
        ]
        if not command:
            return None
        try:
            cwd = str((proc_root / "cwd").resolve())
        except (FileNotFoundError, PermissionError):
            cwd = ""
        try:
            environment = (proc_root / "environ").read_bytes().split(b"\0")
            tmux_pane = next(
                (
                    item.split(b"=", 1)[1].decode("utf-8", errors="replace")
                    for item in environment
                    if item.startswith(b"TMUX_PANE=")
                ),
                "",
            )
        except (FileNotFoundError, PermissionError):
            tmux_pane = ""
        try:
            cgroup = (proc_root / "cgroup").read_text()
            units = SERVICE_RE.findall(cgroup)
            unit = next((item for item in reversed(units) if item not in GENERIC_UNITS), "")
            if unit.startswith("_") and (
                Path.home() / ".config/systemd/user" / unit[1:]
            ).exists():
                unit = unit[1:]
        except (FileNotFoundError, PermissionError):
            unit = ""
        ppid, started_at = proc_stat(pid)
        return ProcessInfo(pid, ppid, command, cwd, tmux_pane, unit, started_at)
    except (FileNotFoundError, PermissionError):
        return None


def process_table() -> dict[int, ProcessInfo]:
    table: dict[int, ProcessInfo] = {}
    for path in Path("/proc").iterdir():
        if not path.name.isdigit():
            continue
        info = read_process(int(path.name))
        if not info:
            continue
        command_name = Path(info.command[0]).name.lower()
        command_text = info.command_text.lower()
        if (
            "websockify" in command_text
            or "x11vnc" in command_name
            or command_name in {"xvfb", "xtigervnc", "xvnc"}
        ):
            table[info.pid] = info
    return table


def tmux_panes() -> dict[str, dict[str, str]]:
    command = [
        "tmux",
        "list-panes",
        "-a",
        "-F",
        "#{pane_id}\t#{session_name}\t#{window_index}.#{pane_index}\t"
        "#{pane_current_path}\t#{pane_current_command}\t#{pane_title}",
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=2, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {}
    panes: dict[str, dict[str, str]] = {}
    for line in result.stdout.splitlines():
        fields = line.split("\t", 5)
        if len(fields) != 6:
            continue
        panes[fields[0]] = {
            "session": fields[1],
            "window": fields[2],
            "path": fields[3],
            "command": fields[4],
            "title": fields[5],
        }
    return panes


def load_config() -> dict[str, Any]:
    try:
        return json.loads(CONFIG_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"ports": {}}


def listening_websockify() -> dict[int, list[int]]:
    try:
        result = subprocess.run(
            ["ss", "-H", "-ltnp"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {}
    listeners: dict[int, list[int]] = {}
    for line in result.stdout.splitlines():
        if "websockify" not in line:
            continue
        fields = line.split(None, 5)
        if len(fields) < 5:
            continue
        address = parse_host_port(fields[3])
        if not address:
            continue
        port = address[1]
        listeners.setdefault(port, [])
        for pid_text in PID_RE.findall(line):
            pid = int(pid_text)
            if pid not in listeners[port]:
                listeners[port].append(pid)
    return listeners


def root_listener_pid(pids: list[int], processes: dict[int, ProcessInfo]) -> int:
    available = [pid for pid in pids if pid in processes]
    if not available:
        return pids[0] if pids else 0
    available_set = set(available)
    roots = [pid for pid in available if processes[pid].ppid not in available_set]
    return min(roots or available, key=lambda pid: processes[pid].started_at or time.time())


def websockify_target(info: ProcessInfo, web_port: int) -> tuple[str, int | None]:
    addresses: list[tuple[int, str, int]] = []
    for index, token in enumerate(info.command):
        parsed = parse_host_port(token)
        if parsed:
            addresses.append((index, parsed[0], parsed[1]))
    for list_index, (_, _, port) in enumerate(addresses):
        if port == web_port and list_index + 1 < len(addresses):
            _, target_host, target_port = addresses[list_index + 1]
            return target_host, target_port
    if len(addresses) >= 2:
        return addresses[-1][1], addresses[-1][2]
    return "127.0.0.1", None


def option_value(command: list[str], option: str) -> str:
    try:
        index = command.index(option)
    except ValueError:
        return ""
    return command[index + 1] if index + 1 < len(command) else ""


def find_vnc_process(
    processes: dict[int, ProcessInfo], vnc_port: int | None
) -> ProcessInfo | None:
    if vnc_port is None:
        return None
    for info in processes.values():
        if Path(info.command[0]).name.lower() != "x11vnc":
            continue
        port_text = option_value(info.command, "-rfbport")
        if port_text.isdigit() and int(port_text) == vnc_port:
            return info
    return None


def find_xserver(
    processes: dict[int, ProcessInfo], display: str
) -> tuple[ProcessInfo | None, str]:
    if not display:
        return None, ""
    for info in processes.values():
        command_name = Path(info.command[0]).name.lower()
        if command_name not in {"xvfb", "xtigervnc", "xvnc"}:
            continue
        if display not in info.command:
            continue
        resolution = ""
        if "-screen" in info.command:
            screen_index = info.command.index("-screen")
            if screen_index + 2 < len(info.command):
                raw = info.command[screen_index + 2]
                match = re.match(r"(\d+x\d+)(?:x\d+)?$", raw)
                if match:
                    resolution = match.group(1)
        return info, resolution
    return None, ""


def format_started_at(timestamp: float) -> str:
    if not timestamp:
        return ""
    return datetime.fromtimestamp(timestamp).astimezone().isoformat(timespec="seconds")


def guess_metadata(
    web_port: int,
    web_process: ProcessInfo,
    pane: dict[str, str] | None,
    override: dict[str, Any],
) -> tuple[str, str, str, int]:
    name = str(override.get("name", "")).strip()
    purpose = str(override.get("purpose", "")).strip()
    project = str(override.get("project", "")).strip()
    priority = int(override.get("priority", 0))
    command_text = web_process.command_text
    if not name and pane:
        name = pane["session"].replace("-", " ").replace("_", " ").title()
    if not name:
        log_match = re.search(r"(?:--log-file=|--log-file\s+)(\S+)", command_text)
        if log_match:
            name = Path(log_match.group(1)).stem.replace("_novnc", "").replace("_", " ").title()
    if not name:
        name = f"noVNC on {web_port}"
    if not purpose:
        purpose = "A dynamically discovered local noVNC desktop."
    if not project and pane:
        project = pane["path"]
    if not project and web_process.cwd not in {"", "/", "/usr/share/novnc"}:
        project = web_process.cwd
    return name, purpose, project, priority


def probe_http(port: int) -> bool:
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/vnc.html",
            headers={"User-Agent": f"noVNC-Manager/{VERSION}"},
        )
        with urllib.request.urlopen(request, timeout=0.8) as response:
            return response.status == HTTPStatus.OK
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def probe_tcp(host: str, port: int | None) -> bool:
    if port is None:
        return False
    connect_host = "127.0.0.1" if host in {"localhost", "::1"} else host
    try:
        with socket.create_connection((connect_host, port), timeout=0.5):
            return True
    except OSError:
        return False


def inventory() -> dict[str, Any]:
    now = time.time()
    config = load_config()
    processes = process_table()
    panes = tmux_panes()
    listeners = listening_websockify()
    pending: list[dict[str, Any]] = []

    for web_port, listener_pids in listeners.items():
        web_pid = root_listener_pid(listener_pids, processes)
        web_process = processes.get(web_pid) or read_process(web_pid)
        if not web_process:
            continue
        vnc_host, vnc_port = websockify_target(web_process, web_port)
        vnc_process = find_vnc_process(processes, vnc_port)
        display = option_value(vnc_process.command, "-display") if vnc_process else ""
        xserver, resolution = find_xserver(processes, display)
        tmux_pane = (
            web_process.tmux_pane
            or (vnc_process.tmux_pane if vnc_process else "")
            or (xserver.tmux_pane if xserver else "")
        )
        pane = panes.get(tmux_pane)
        override = config.get("ports", {}).get(str(web_port), {})
        name, purpose, project, priority = guess_metadata(
            web_port, web_process, pane, override
        )
        service = web_process.unit
        if service:
            source_kind = "systemd"
            source_detail = service
        elif pane:
            source_kind = "tmux"
            source_detail = f"{pane['session']}:{pane['window']}"
        else:
            source_kind = "process"
            source_detail = f"PID {web_pid}"
        configured_source = str(override.get("source", "")).strip()
        source_path = configured_source or project
        pending.append(
            {
                "web_port": web_port,
                "web_pid": web_pid,
                "web_process": web_process,
                "vnc_host": vnc_host,
                "vnc_port": vnc_port,
                "vnc_process": vnc_process,
                "display": display,
                "resolution": resolution,
                "pane": pane,
                "name": name,
                "purpose": purpose,
                "priority": priority,
                "service": service,
                "source_kind": source_kind,
                "source_detail": source_detail,
                "source_path": source_path,
            }
        )

    def probe(item: dict[str, Any]) -> tuple[bool, bool]:
        return probe_http(item["web_port"]), probe_tcp(item["vnc_host"], item["vnc_port"])

    sessions: list[SessionInfo] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        health = list(executor.map(probe, pending))

    for item, (http_ok, vnc_ok) in zip(pending, health):
        status = "online" if http_ok and vnc_ok else "degraded" if http_ok else "offline"
        web_process = item["web_process"]
        pane = item["pane"] or {}
        url = (
            f"http://127.0.0.1:{item['web_port']}/vnc.html"
            f"?host=127.0.0.1&port={item['web_port']}&autoconnect=1&resize=scale"
        )
        sessions.append(
            SessionInfo(
                id=f"novnc-{item['web_port']}",
                name=item["name"],
                purpose=item["purpose"],
                status=status,
                http_ok=http_ok,
                vnc_ok=vnc_ok,
                web_host="127.0.0.1",
                web_port=item["web_port"],
                vnc_host=item["vnc_host"],
                vnc_port=item["vnc_port"],
                display=item["display"],
                resolution=item["resolution"],
                web_pid=item["web_pid"],
                vnc_pid=item["vnc_process"].pid if item["vnc_process"] else None,
                tmux_session=pane.get("session", ""),
                tmux_window=pane.get("window", ""),
                service=item["service"],
                source_path=item["source_path"],
                source_kind=item["source_kind"],
                source_detail=item["source_detail"],
                command=web_process.command_text,
                started_at=format_started_at(web_process.started_at),
                uptime_seconds=max(0, int(now - web_process.started_at))
                if web_process.started_at
                else 0,
                url=url,
                preview_url=f"{url}&view_only=1&shared=1",
                priority=item["priority"],
            )
        )

    sessions.sort(key=lambda item: (-item.priority, item.status != "online", item.name.lower()))
    counts = {
        "total": len(sessions),
        "online": sum(item.status == "online" for item in sessions),
        "degraded": sum(item.status == "degraded" for item in sessions),
        "offline": sum(item.status == "offline" for item in sessions),
    }
    return {
        "version": VERSION,
        "scanned_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "counts": counts,
        "sessions": [asdict(item) for item in sessions],
    }


class ManagerHandler(SimpleHTTPRequestHandler):
    server_version = f"noVNCManager/{VERSION}"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; connect-src 'self'; "
            "frame-src http://127.0.0.1:* http://localhost:*;",
        )
        super().end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/instances":
            try:
                payload = json.dumps(inventory(), ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as error:  # Keep the dashboard responsive if discovery fails.
                payload = json.dumps(
                    {"error": str(error), "sessions": [], "counts": {"total": 0}}
                ).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            return
        if self.path == "/healthz":
            payload = b'{"status":"ok"}'
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path in {"/", "/index.html"}:
            self.path = "/index.html"
        super().do_GET()

    def log_message(self, format_string: str, *args: Any) -> None:
        print(
            f"{self.log_date_time_string()} {self.client_address[0]} "
            f"{format_string % args}",
            flush=True,
        )


class ManagerServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7080)
    args = parser.parse_args()
    server = ManagerServer((args.host, args.port), ManagerHandler)
    print(f"noVNC Manager {VERSION} listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
