#!/usr/bin/env bash
set -euo pipefail

manager_port="${NOVNC_MANAGER_PORT:-7080}"
manager_url="${NOVNC_MANAGER_URL:-http://127.0.0.1:${manager_port}}"
profile_dir="${NOVNC_MANAGER_PROFILE:-${HOME}/.cache/novnc-manager-gui}"
runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
user_bus="unix:path=${runtime_dir}/bus"

if ! curl --silent --show-error --fail --max-time 2 \
    "${manager_url}/healthz" >/dev/null 2>&1; then
    env XDG_RUNTIME_DIR="$runtime_dir" DBUS_SESSION_BUS_ADDRESS="$user_bus" \
        systemctl --user start novnc-manager.service
    for _attempt in $(seq 1 20); do
        if curl --silent --show-error --fail --max-time 1 \
            "${manager_url}/healthz" >/dev/null 2>&1; then
            break
        fi
        sleep 0.25
    done
fi

if command -v google-chrome >/dev/null 2>&1; then
    google-chrome \
        --app="$manager_url" \
        --class=NoVNCManager \
        --disable-dev-shm-usage \
        --disable-gpu \
        --disable-gpu-compositing \
        --disable-session-crashed-bubble \
        --no-default-browser-check \
        --no-first-run \
        --password-store=basic \
        --start-maximized \
        --user-data-dir="$profile_dir" &
    browser_pid=$!

    if command -v xdotool >/dev/null 2>&1; then
        for _attempt in $(seq 1 30); do
            window_id="$(
                xdotool search --onlyvisible --name 'noVNC Session Manager' \
                    2>/dev/null | tail -n 1 || true
            )"
            if [[ -n "$window_id" ]]; then
                read -r display_width display_height < <(xdotool getdisplaygeometry)
                xdotool windowmove --sync "$window_id" 0 0 >/dev/null 2>&1 || true
                xdotool windowsize --sync "$window_id" \
                    "$display_width" "$display_height" >/dev/null 2>&1 || true
                break
            fi
            sleep 0.2
        done
    fi

    wait "$browser_pid"
    exit $?
fi

exec xdg-open "$manager_url"
