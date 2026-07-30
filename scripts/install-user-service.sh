#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
systemd_project_root="${project_root//\\/\\\\}"
systemd_project_root="${systemd_project_root// /\\\\x20}"
manager_port="${NOVNC_MANAGER_PORT:-7080}"
runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
user_bus="unix:path=${runtime_dir}/bus"
service_dir="${HOME}/.config/systemd/user"
desktop_dir="${HOME}/.local/share/applications"
icon_dir="${HOME}/.local/share/icons/hicolor/scalable/apps"
bin_dir="${HOME}/.local/bin"
temporary_dir="$(mktemp -d)"

cleanup() {
    rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

for command_name in python3 ss curl systemctl; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$command_name" >&2
        exit 1
    fi
done

install -d "$service_dir" "$desktop_dir" "$icon_dir" "$bin_dir"
install -m 0755 "$project_root/scripts/open-manager.sh" \
    "$bin_dir/novnc-manager"
install -m 0644 "$project_root/assets/novnc-manager.svg" \
    "$icon_dir/novnc-manager.svg"

sed \
    -e "s|@PROJECT_ROOT@|$project_root|g" \
    -e "s|@PROJECT_ROOT_SYSTEMD@|$systemd_project_root|g" \
    -e "s|@PORT@|$manager_port|g" \
    "$project_root/packaging/novnc-manager.service.in" \
    > "$temporary_dir/novnc-manager.service"
install -m 0644 "$temporary_dir/novnc-manager.service" \
    "$service_dir/novnc-manager.service"

sed \
    -e "s|@OPEN_SCRIPT@|$bin_dir/novnc-manager|g" \
    "$project_root/packaging/novnc-manager.desktop.in" \
    > "$temporary_dir/novnc-manager.desktop"
install -m 0644 "$temporary_dir/novnc-manager.desktop" \
    "$desktop_dir/novnc-manager.desktop"

systemctl_user=(
    env
    "XDG_RUNTIME_DIR=$runtime_dir"
    "DBUS_SESSION_BUS_ADDRESS=$user_bus"
    systemctl --user
)
"${systemctl_user[@]}" daemon-reload
"${systemctl_user[@]}" enable --now novnc-manager.service

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$desktop_dir"
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache --force --ignore-theme-index \
        "${HOME}/.local/share/icons/hicolor" >/dev/null
fi

printf 'Installed noVNC Session Manager at http://127.0.0.1:%s\n' "$manager_port"
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" != "yes" ]]; then
    printf 'For startup before login, run once: sudo loginctl enable-linger %q\n' "$USER"
fi
