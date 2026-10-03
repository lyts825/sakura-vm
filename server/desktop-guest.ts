import {
  defaultDesktopPreferences,
  desktopPreferencesSchema,
  type DesktopPreferences,
} from './desktop-preferences.ts';
import { desktopLauncher, desktopLauncherPath } from './desktop-binding.ts';
import type { Project } from './workspaces.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';
import { z } from 'zod';
import { quote } from './files.ts';

// These scripts run only inside the managed guest, over its existing SSH connection.
// TigerVNC owns the outer X server. Wayland-only distros nest KWin inside it.
// BusyBox pgrep matches argv[0], which KDE launches with an absolute path.
const displayReady = 'timeout 3 env DISPLAY=:1 XAUTHORITY=/run/sakura-desktop/Xauthority xdpyinfo';
const plasmaReady =
  "test -f /run/sakura-desktop/ready && pgrep -u sakura-desktop -f '(^|/)plasmashell( |$)' >/dev/null 2>&1 && pgrep -u sakura-desktop -f '(^|/)kwin_(x11|wayland)( |$)' >/dev/null 2>&1 && " + displayReady + ' >/dev/null 2>&1';
export const desktopProbe = String.raw`if [ ! -f /etc/sakura/desktop-version ]; then
  printf 'not-installed\n'
elif rc-service sakura-desktop status >/dev/null 2>&1; then
  if ${plasmaReady}; then
    printf 'ready\n'
  else
    printf 'starting\n'
  fi
else
  printf 'stopped\n'
fi`;
export const desktopPreferencesProbe = String.raw`if [ -f /etc/sakura/desktop-preferences ]; then
  cat /etc/sakura/desktop-preferences
fi`;

export const desktopStart = String.raw`set -eu
test -f /etc/sakura/desktop-version
rc-service dbus start
rc-service sakura-desktop restart
for attempt in $(seq 1 120); do
  if ${plasmaReady}; then exit 0; fi
  sleep 1
done
tail -c 8192 /var/log/sakura-desktop.log
exit 1`;

export const desktopFramebufferSetup = String.raw`width=$(printf '%s' "$RESOLUTION" | cut -dx -f1)
height=$(printf '%s' "$RESOLUTION" | cut -dx -f2)
case "$MONITOR_LAYOUT" in
  single) FRAMEBUFFER="$RESOLUTION" ;;
  dual-horizontal) FRAMEBUFFER="$((width * 2))x$height" ;;
  dual-vertical) FRAMEBUFFER="$width"x"$((height * 2))" ;;
  *) echo 'Invalid monitor layout' >&2; exit 1 ;;
esac
export FRAMEBUFFER`;

export const desktopMonitorSetup = String.raw`if [ "$MONITOR_LAYOUT" != single ]; then
  command -v xrandr >/dev/null || { echo 'Install xrandr before enabling two monitors' >&2; exit 1; }
  output=$(xrandr --query | awk '$2 == "connected" { print $1; exit }')
  [ -n "$output" ] || { echo 'No Xvnc output for logical monitors' >&2; exit 1; }
  mm_width=$((width * 254 / 960))
  mm_height=$((height * 254 / 960))
  first=$(printf '%s/%sx%s/%s+0+0' "$width" "$mm_width" "$height" "$mm_height")
  if [ "$MONITOR_LAYOUT" = dual-horizontal ]; then second_x=$width; second_y=0
  else second_x=0; second_y=$height; fi
  second=$(printf '%s/%sx%s/%s+%s+%s' "$width" "$mm_width" "$height" "$mm_height" "$second_x" "$second_y")
  xrandr --setmonitor sakura-primary "$first" "$output"
  xrandr --setmonitor sakura-secondary "$second" none
  [ "$(xrandr --listmonitors | awk 'NR == 1 { print $2 }')" = 2 ] || {
    echo 'Xvnc did not publish both logical monitors' >&2; exit 1;
  }
fi`;

function shellLiteral(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const desktopDebianPackages = 'kde-plasma-desktop plasma-workspace-wayland kwin-x11 kwin-wayland qtwayland5 systemsettings breeze breeze-icon-theme konsole dolphin tigervnc-standalone-server dbus-x11 fonts-dejavu fonts-noto-cjk xauth x11-utils x11-xserver-utils netcat-openbsd python3 iproute2 util-linux'.split(' ');
const imeDebianPackages = ['fcitx5', 'fcitx5-chinese-addons', 'fcitx5-frontend-gtk3', 'fcitx5-frontend-qt5'];

function aptPrepare(packages: readonly string[], noRecommends = true) {
  const names = packages.map(quote).join(' ');
  const statusFormat = quote('${db:Status-Status} ${db:Status-Eflag}');
  // A complete fixed package set needs no APT writer lock. Query both the
  // actual install phase and error flag; selection holds do not make an
  // already configured package incomplete. Failed queries must not skip APT.
  return String.raw`export DEBIAN_FRONTEND=noninteractive
sakura_packages_ready=1
for sakura_package in ${names}; do
  if ! sakura_package_status=$(dpkg-query -W -f=${statusFormat} "$sakura_package" 2>/dev/null) || [ "$sakura_package_status" != 'installed ok' ]; then
    sakura_packages_ready=0
    break
  fi
done
if [ "$sakura_packages_ready" != 1 ]; then
  apt-get -o DPkg::Lock::Timeout=120 -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update
  apt-get -o DPkg::Lock::Timeout=120 -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y${noRecommends ? ' --no-install-recommends' : ''} ${names}
fi`;
}

function desktopConfigScript(input: DesktopPreferences) {
  const p = desktopPreferencesSchema.parse(input);
  const factor = (p.scale / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(p.accent.slice(offset, offset + 2), 16)).join(',');
  return String.raw`mkdir -p /etc/sakura
cat > /etc/sakura/desktop-preferences <<'SAKURA_PREFERENCES'
DESKTOP=kde-plasma
SESSION_TYPE=${shellLiteral(p.sessionType)}
RESOLUTION=${shellLiteral(p.resolution)}
MONITOR_LAYOUT=${shellLiteral(p.monitorLayout)}
SCALE=${shellLiteral(String(p.scale))}
QT_SCALE_FACTOR=${shellLiteral(factor)}
THEME=${shellLiteral(p.theme)}
WALLPAPER=${shellLiteral(p.wallpaper)}
ACCENT=${shellLiteral(p.accent.toLowerCase())}
ACCENT_RGB=${shellLiteral(rgb)}
PANEL=${shellLiteral(p.panel)}
AUTO_HIDE_PANEL=${shellLiteral(String(p.autoHidePanel))}
ANIMATIONS=${shellLiteral(String(p.animations))}
SAKURA_PREFERENCES
chmod 644 /etc/sakura/desktop-preferences`;
}

const defaultLauncherProject: Project = { directory: '/home/sakura-desktop', template: 'none', repository: '', setup: '', command: '' };
export const desktopInstall =
  String.raw`timeout -s TERM 900 /bin/sh <<'SAKURA_INSTALL'
set -eu
case "$(cat /etc/alpine-release)" in
  3.23.*) ;;
  *) echo 'Desktop setup currently requires Alpine 3.23.' >&2; exit 1 ;;
esac
mkdir -p /etc/sakura /usr/local/libexec
if ! mkdir /run/sakura-desktop-install.lock 2>/dev/null; then
  echo 'Another desktop installation is still running. Retry after it finishes or reboot.' >&2
  exit 1
fi
trap 'rmdir /run/sakura-desktop-install.lock' EXIT
trap 'exit 1' HUP INT TERM
# Use this release's community repository without changing the existing repositories.
echo 'Installing KDE Plasma and TigerVNC. The first installation needs internet access.'
apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/v3.23/community \
  plasma-desktop plasma-workspace kwin systemsettings breeze breeze-icons konsole dolphin tigervnc dbus dbus-x11 dbus-openrc \
  kquickcharts kpipewire tzdata font-dejavu font-noto-cjk xauth xdpyinfo xrandr python3 iproute2 setpriv
if ! id sakura-desktop >/dev/null 2>&1; then
  adduser -D -h /home/sakura-desktop -s /bin/sh sakura-desktop
fi
test "$(id -u sakura-desktop)" != 0
test "$(awk -F: '$1 == "sakura-desktop" { print $6 }' /etc/passwd)" = /home/sakura-desktop
if [ ! -e ${desktopLauncherPath} ]; then
cat > ${desktopLauncherPath} <<'SAKURA_LAUNCHER'
${desktopLauncher(defaultLauncherProject)}SAKURA_LAUNCHER
chmod 700 ${desktopLauncherPath}
fi
test -f ${desktopLauncherPath} && test ! -L ${desktopLauncherPath}
test "$(stat -c %u ${desktopLauncherPath})" = 0
${desktopConfigScript(defaultDesktopPreferences)}
cat > /usr/local/libexec/sakura-desktop-session <<'SAKURA_SESSION'
#!/bin/sh
set -eu
export DISPLAY=:1 XDG_RUNTIME_DIR=/run/sakura-desktop
export XAUTHORITY=/run/sakura-desktop/Xauthority
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma KDE_FULL_SESSION=true
unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS WAYLAND_DISPLAY WAYLAND_SOCKET
[ ! -f /home/sakura-desktop/.sakura-ime ] || . /home/sakura-desktop/.sakura-ime
RESOLUTION=1280x800
SESSION_TYPE=auto
MONITOR_LAYOUT=single
QT_SCALE_FACTOR=1
THEME=sakura
ACCENT=#c75b86
PANEL=bottom
AUTO_HIDE_PANEL=false
ANIMATIONS=true
WALLPAPER=sakura
ACCENT_RGB=199,91,134
[ ! -f /etc/sakura/desktop-preferences ] || . /etc/sakura/desktop-preferences
${desktopFramebufferSetup}
export SESSION_TYPE RESOLUTION MONITOR_LAYOUT QT_SCALE_FACTOR THEME ACCENT PANEL AUTO_HIDE_PANEL ANIMATIONS WALLPAPER ACCENT_RGB
export LIBGL_ALWAYS_SOFTWARE=1 QT_QUICK_BACKEND=software
write_kde() {
  if command -v kwriteconfig6 >/dev/null 2>&1; then kwriteconfig6 "$@"
  elif command -v kwriteconfig5 >/dev/null 2>&1; then kwriteconfig5 "$@"; fi
}
mkdir -p /home/sakura-desktop/.config /home/sakura-desktop/.local/share/wallpapers
rm -f /run/sakura-desktop/ready
# This service has its own D-Bus session, not a systemd user login session.
write_kde --file startkderc --group General --key systemdBoot false
# The graphical account has no password: avoid an un-unlockable idle lock screen.
if [ ! -f /home/sakura-desktop/.config/kscreenlockerrc ]; then
  write_kde --file kscreenlockerrc --group Daemon --key Autolock false
  write_kde --file kscreenlockerrc --group Daemon --key LockOnResume false
fi
if ! cmp -s /etc/sakura/desktop-preferences /home/sakura-desktop/.config/sakura-applied-preferences; then
  case "$THEME" in midnight) scheme=BreezeDark ;; *) scheme=BreezeLight ;; esac
  write_kde --file kdeglobals --group General --key ColorScheme "$scheme"
  write_kde --file kdeglobals --group General --key AccentColor "$ACCENT_RGB"
  if [ "$ANIMATIONS" = true ]; then speed=1; else speed=0; fi
  write_kde --file kdeglobals --group KDE --key AnimationDurationFactor "$speed"
fi
xauth -f "$XAUTHORITY" add :1 . "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
Xvnc :1 -geometry "$FRAMEBUFFER" -depth 24 -rfbport 5901 -interface 127.0.0.1 \
  -localhost -SecurityTypes None -AlwaysShared -nolisten tcp -auth "$XAUTHORITY" &
vnc_pid=$!
session_pid=''
cleanup() {
  trap - EXIT HUP INT TERM
  rm -f /run/sakura-desktop/ready
  [ -z "$session_pid" ] || kill "$session_pid" 2>/dev/null || true
  kill "$vnc_pid" 2>/dev/null || true
  wait || true
}
trap cleanup EXIT
trap 'exit 0' HUP INT TERM
for attempt in $(seq 1 40); do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  kill -0 "$vnc_pid"
  sleep 0.25
done
xdpyinfo >/dev/null
${desktopMonitorSetup}
dbus-run-session -- /usr/local/libexec/sakura-plasma-session &
session_pid=$!
# Either child can fail while the other is still alive (notably nested Wayland).
# Exit with failure so both OpenRC and systemd restart the complete session.
while kill -0 "$vnc_pid" 2>/dev/null && kill -0 "$session_pid" 2>/dev/null; do
  sleep 1
done
exit 1
SAKURA_SESSION
chmod 755 /usr/local/libexec/sakura-desktop-session
mkdir -p /usr/local/libexec/sakura-plasma
cat > /usr/local/libexec/sakura-plasma/kwin_wayland_wrapper <<'SAKURA_KWIN'
#!/bin/sh
# Scope the wrapper to Sakura; system Plasma sessions keep the vendor binary.
if [ -x /usr/bin/kwin_wayland_wrapper ]; then kwin=/usr/bin/kwin_wayland_wrapper
else kwin=/usr/bin/kwin_wayland; fi
exec "$kwin" "$@" --x11-display :1 --width "$(printf '%s' "$FRAMEBUFFER" | cut -dx -f1)" --height "$(printf '%s' "$FRAMEBUFFER" | cut -dx -f2)" --no-lockscreen
SAKURA_KWIN
chmod 755 /usr/local/libexec/sakura-plasma/kwin_wayland_wrapper
cat > /usr/local/libexec/sakura-plasma-session <<'SAKURA_PLASMA'
#!/bin/sh
set -eu
/usr/local/libexec/sakura-apply-layout &
if [ "$SESSION_TYPE" = wayland ] || { [ "$SESSION_TYPE" = auto ] && ! command -v startplasma-x11 >/dev/null 2>&1; }; then
  command -v startplasma-wayland >/dev/null 2>&1 || { echo 'Native Wayland Plasma is not installed.' >&2; exit 1; }
  export PATH=/usr/local/libexec/sakura-plasma:$PATH
  export XDG_SESSION_TYPE=wayland KWIN_COMPOSE=QPainter
  exec startplasma-wayland
elif command -v startplasma-x11 >/dev/null 2>&1; then
  export XDG_SESSION_TYPE=x11
  exec startplasma-x11
else
  echo 'No supported Plasma session entry point was installed.' >&2
  exit 1
fi
SAKURA_PLASMA
chmod 755 /usr/local/libexec/sakura-plasma-session
cat > /usr/local/libexec/sakura-apply-layout <<'SAKURA_LAYOUT'
#!/bin/sh
set -eu
# Wait for actual Plasma containments before applying panel and wallpaper preferences.
ready_script='string:if (!desktops().length || !panels().length) throw "plasma-not-ready";'
ready=0
for attempt in $(seq 1 90); do
  if dbus-send --session --reply-timeout=1000 --print-reply --dest=org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "$ready_script" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" -eq 1 ]
if ! cmp -s /etc/sakura/desktop-preferences /home/sakura-desktop/.config/sakura-applied-preferences; then
  case "$THEME" in midnight) scheme=BreezeDark ;; *) scheme=BreezeLight ;; esac
  if command -v plasma-apply-colorscheme >/dev/null 2>&1; then
    plasma-apply-colorscheme "$scheme" --accent-color "$ACCENT" || true
  fi
  dbus-send --session --print-reply --dest=org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "string:
    var ps = panels();
    for (var i = 0; i < ps.length; i++) {
      ps[i].location = '$PANEL' === 'top' ? 'top' : 'bottom';
      ps[i].hiding = '$AUTO_HIDE_PANEL' === 'true' ? 'autohide' : 'none';
      if ('floating' in ps[i]) ps[i].floating = '$PANEL' === 'floating';
    }
    var ds = desktops();
    for (var i = 0; i < ds.length; i++) {
      ds[i].wallpaperPlugin = '$WALLPAPER' === 'plain' ? 'org.kde.color' : 'org.kde.image';
      ds[i].currentConfigGroup = ['Wallpaper', ds[i].wallpaperPlugin, 'General'];
      if ('$WALLPAPER' === 'plain') ds[i].writeConfig('Color', '$ACCENT');
      else ds[i].writeConfig('Image', 'file:///home/sakura-desktop/.local/share/wallpapers/$WALLPAPER.svg');
      ds[i].reloadConfig();
    }"
  cp /etc/sakura/desktop-preferences /home/sakura-desktop/.config/sakura-applied-preferences
fi
touch /run/sakura-desktop/ready
SAKURA_LAYOUT
chmod 755 /usr/local/libexec/sakura-apply-layout
cat > /etc/init.d/sakura-desktop <<'SAKURA_SERVICE'
#!/sbin/openrc-run
description="Sakura KDE Plasma desktop over SSH"
command="${desktopLauncherPath}"
supervisor="supervise-daemon"
respawn_delay=3
respawn_max=5
respawn_period=60
output_log="/var/log/sakura-desktop.log"
error_log="/var/log/sakura-desktop.log"
depend() {
  need dbus
  after net
}
start_pre() {
  checkpath -d -m 0700 -o sakura-desktop:sakura-desktop /run/sakura-desktop
}
SAKURA_SERVICE
chmod 755 /etc/init.d/sakura-desktop
mkdir -p /home/sakura-desktop/.config /home/sakura-desktop/.local/share/wallpapers
cat > /home/sakura-desktop/.local/share/wallpapers/sakura.svg <<'SAKURA_WALLPAPER'
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2b2032"/><stop offset=".58" stop-color="#8d4b72"/><stop offset="1" stop-color="#e3a7c5"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><circle cx="1540" cy="170" r="260" fill="#fff" opacity=".08"/><path d="M-80 900C390 600 520 740 900 420s620-320 1110-510" fill="none" stroke="#ffdce9" stroke-width="18" opacity=".42"/><g fill="#fff1f7" opacity=".8"><circle cx="520" cy="240" r="11"/><circle cx="680" cy="330" r="8"/><circle cx="1240" cy="520" r="12"/><circle cx="1460" cy="390" r="7"/></g></svg>
SAKURA_WALLPAPER
cat > /home/sakura-desktop/.local/share/wallpapers/midnight.svg <<'MIDNIGHT_WALLPAPER'
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#151526"/><stop offset=".6" stop-color="#332548"/><stop offset="1" stop-color="#8c597f"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><circle cx="1480" cy="210" r="130" fill="#f5d9ea" opacity=".18"/><path d="M-120 980C360 720 560 850 980 470s650-340 1080-560" fill="none" stroke="#d8b4de" stroke-width="14" opacity=".32"/><g fill="#fce4f2" opacity=".7"><circle cx="410" cy="210" r="5"/><circle cx="830" cy="180" r="8"/><circle cx="1280" cy="480" r="5"/><circle cx="1600" cy="690" r="8"/></g></svg>
MIDNIGHT_WALLPAPER
cat > /home/sakura-desktop/.local/share/wallpapers/paper.svg <<'PAPER_WALLPAPER'
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffaf3"/><stop offset=".62" stop-color="#f2e7ec"/><stop offset="1" stop-color="#d4d9ec"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><path d="M-60 940C360 700 610 800 980 500s610-360 1080-590" fill="none" stroke="#9ba7cf" stroke-width="18" opacity=".34"/><circle cx="1530" cy="210" r="190" fill="#fff" opacity=".45"/></svg>
PAPER_WALLPAPER
chown -R sakura-desktop:sakura-desktop /home/sakura-desktop/.config /home/sakura-desktop/.local
rc-update add dbus default
rc-update del sakura-desktop default >/dev/null 2>&1 || true
printf '5\n' > /etc/sakura/desktop-version
echo 'Starting the desktop session…'
` +
  desktopStart +
  String.raw`
echo 'KDE Plasma desktop is ready.'
SAKURA_INSTALL`;

export function desktopCommands(distro = 'alpine', input: Partial<DesktopPreferences> = defaultDesktopPreferences, project?: Project) {
  const preferences = desktopPreferencesSchema.parse(input);
  const sessionAvailable = preferences.sessionType === 'wayland'
    ? 'command -v startplasma-wayland >/dev/null 2>&1'
    : preferences.sessionType === 'x11'
      ? 'command -v startplasma-x11 >/dev/null 2>&1'
      : '(command -v startplasma-x11 >/dev/null 2>&1 || command -v startplasma-wayland >/dev/null 2>&1)';
  const versionProbe = `grep -qx '5' /etc/sakura/desktop-version 2>/dev/null && ${sessionAvailable}`;
  const scope = (script: string) => project?.networkIsolation === 'private'
    ? script.replaceAll(displayReady, projectNetworkCommand(project, displayReady)) : script;
  const prepare = (install: string, start: string) => install.replace(start, '')
    .replace("echo 'KDE Plasma desktop is ready.'", "echo 'KDE Plasma installation prepared.'");
  const startWithPreferences = (start: string, install: string) => String.raw`set -eu
if ! { ${versionProbe}; }; then
${install}
else
${desktopConfigScript(preferences)}
${start}
fi`;
  const configure = (start: string, install: string) => String.raw`set -eu
test -f /etc/sakura/desktop-version
if ! { ${versionProbe}; }; then
  echo 'Upgrading KDE Plasma desktop for native Wayland sessions…'
${install}
else
${desktopConfigScript(preferences)}
echo 'Applying KDE Plasma preferences and restarting the desktop session…'
${start}
fi
echo 'KDE Plasma preferences applied.'`;
  const customizedInstall = desktopInstall.replace(desktopLauncher(defaultLauncherProject), desktopLauncher(defaultLauncherProject, distro)).replace(
    desktopConfigScript(defaultDesktopPreferences),
    desktopConfigScript(preferences),
  );
  if (distro === 'alpine')
    return {
      probe: scope(desktopProbe),
      preferencesProbe: desktopPreferencesProbe,
      versionProbe,
      start: scope(desktopStart),
      startWithPreferences: scope(startWithPreferences(desktopStart, customizedInstall)),
      install: scope(customizedInstall),
      prepare: prepare(customizedInstall, desktopStart),
      configure: scope(configure(desktopStart, customizedInstall)),
      preferences,
    };
  const probe = desktopProbe.replace(
    'rc-service sakura-desktop status',
    'systemctl is-active --quiet sakura-desktop',
  );
  const start = desktopStart.replace(
    'rc-service dbus start\nrc-service sakura-desktop restart',
    'systemctl start dbus\nsystemctl restart sakura-desktop',
  );
  const unit = `cat > /etc/systemd/system/sakura-desktop.service <<'SAKURA_SERVICE'
[Unit]
Description=Sakura KDE Plasma desktop
After=network.target dbus.service
Requires=dbus.service
[Service]
Type=simple
User=root
Group=root
RuntimeDirectory=sakura-desktop
RuntimeDirectoryMode=0700
ExecStart=${desktopLauncherPath}
Restart=on-failure
RestartSec=3
StandardOutput=append:/var/log/sakura-desktop.log
StandardError=append:/var/log/sakura-desktop.log
[Install]
WantedBy=multi-user.target
SAKURA_SERVICE`;
  const install = customizedInstall
    .replace(/case "\$\(cat \/etc\/alpine-release\)" in[\s\S]*?esac/, '')
    .replace(
      /apk add --no-cache[\s\S]*?xauth xdpyinfo xrandr python3 iproute2 setpriv/,
      aptPrepare(desktopDebianPackages),
    )
    .replace(
      'adduser -D -h /home/sakura-desktop -s /bin/sh sakura-desktop',
      'useradd --user-group --create-home --home-dir /home/sakura-desktop --shell /bin/sh sakura-desktop',
    )
    .replace('Xvnc :1', 'Xtigervnc :1')
    .replace(/cat > \/etc\/init.d\/sakura-desktop[\s\S]*?chmod 755 \/etc\/init.d\/sakura-desktop/, unit)
    .replace(
      'rc-update add dbus default\nrc-update del sakura-desktop default >/dev/null 2>&1 || true',
      'systemctl daemon-reload\nsystemctl disable sakura-desktop',
    )
    .replace(desktopStart, start);
  return {
    probe: scope(probe),
    preferencesProbe: desktopPreferencesProbe,
    versionProbe,
    start: scope(start),
    startWithPreferences: scope(startWithPreferences(start, install)),
    install: scope(install),
    prepare: prepare(install, start),
    configure: scope(configure(start, install)),
    preferences,
  };
}

export function imeInstall(distro = 'alpine') {
  const install =
    distro === 'alpine'
      ? 'apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/v3.23/community fcitx5 fcitx5-chinese-addons fcitx5-gtk fcitx5-qt'
      : aptPrepare(imeDebianPackages, false);
  return (
    `set -eu\nid sakura-desktop >/dev/null\n${install}\n` +
    String.raw`
mkdir -p /home/sakura-desktop/.config/autostart /home/sakura-desktop/.config/fcitx5
cat > /home/sakura-desktop/.config/autostart/fcitx5.desktop <<'SAKURA_IME'
[Desktop Entry]
Type=Application
Name=Chinese Input
Exec=fcitx5 -d
SAKURA_IME
if [ ! -f /home/sakura-desktop/.config/fcitx5/profile ]; then
cat > /home/sakura-desktop/.config/fcitx5/profile <<'SAKURA_IME'
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=pinyin
[Groups/0/Items/0]
Name=keyboard-us
Layout=
[Groups/0/Items/1]
Name=pinyin
Layout=
[GroupOrder]
0=Default
SAKURA_IME
fi
cat > /home/sakura-desktop/.sakura-ime <<'SAKURA_IME'
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
SAKURA_IME
chown -R sakura-desktop:sakura-desktop /home/sakura-desktop/.config /home/sakura-desktop/.sakura-ime
if ! grep -q '.sakura-ime' /usr/local/libexec/sakura-desktop-session; then
  sed -i '/^unset SESSION_MANAGER/a [ ! -f /home/sakura-desktop/.sakura-ime ] || . /home/sakura-desktop/.sakura-ime' /usr/local/libexec/sakura-desktop-session
fi
echo 'Chinese input installed. Restarting desktop; use Ctrl+Space to switch.'
` +
    desktopCommands(distro).start
  );
}

/** This administration task has no project environment, cwd, HOME or startup hook. */
export function desktopProjectImePrepare(distro: string) {
  const packages = distro === 'alpine'
    ? 'apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/v3.23/community fcitx5 fcitx5-chinese-addons fcitx5-gtk fcitx5-qt'
    : aptPrepare(imeDebianPackages);
  return 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ' + quote('set -eu\ncd /\n' + packages);
}

/** Run only inside the protected Desktop frame, after the native UID drop. */
export const desktopProjectImeCommand = String.raw`set -eu
umask 077
mkdir -p "$HOME/.config/autostart" "$HOME/.config/fcitx5"
cat > "$HOME/.config/autostart/fcitx5.desktop" <<'SAKURA_UID_IME'
[Desktop Entry]
Type=Application
Name=Chinese Input
Exec=fcitx5 -d
SAKURA_UID_IME
if [ ! -f "$HOME/.config/fcitx5/profile" ]; then
cat > "$HOME/.config/fcitx5/profile" <<'SAKURA_UID_IME'
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=pinyin
[Groups/0/Items/0]
Name=keyboard-us
Layout=
[Groups/0/Items/1]
Name=pinyin
Layout=
[GroupOrder]
0=Default
SAKURA_UID_IME
fi
cat > "$HOME/.sakura-ime" <<'SAKURA_UID_IME'
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
SAKURA_UID_IME
`;

/** The complete session body is transported to the native UID launcher as data. */
export function desktopUidCommand(runId: string, input: DesktopPreferences, distro: string, uid: number) {
  z.uuid().parse(runId);
  z.number().int().min(20000).max(59999).parse(uid);
  const preferences = desktopPreferencesSchema.parse(input);
  const body = (marker: string) => {
    const match = new RegExp(`<<'${marker}'\\n([\\s\\S]*?)\\n${marker}`).exec(desktopInstall);
    if (!match) throw new Error('Desktop trusted adapter body missing: ' + marker);
    return match[1];
  };
  // Preserve Plasma preferences, nested Wayland, monitor layout and IME hooks.
  // Every transformed path belongs to the real native project HOME, and every
  // hook is read only after the C launcher has dropped UID/GID and all authority FDs.
  const transform = (script: string) => script.replaceAll('/home/sakura-desktop', '$HOME')
    .replaceAll('/run/sakura-desktop', '$SAKURA_DESKTOP_RUNTIME')
    .replaceAll('/etc/sakura/desktop-preferences', '$SAKURA_DESKTOP_RUNTIME/preferences')
    .replaceAll('/usr/local/libexec/sakura-plasma-session', '$SAKURA_DESKTOP_RUNTIME/plasma-session')
    .replaceAll('/usr/local/libexec/sakura-apply-layout', '$SAKURA_DESKTOP_RUNTIME/apply-layout')
    .replaceAll('file://$HOME/', 'file://$HOME/')
    .replace('Xvnc :1', (distro === 'alpine' ? '/usr/bin/Xvnc' : '/usr/bin/Xtigervnc') + ' :1');
  const interpreterEntry = (script: string, direct: string, interpreted: string) => {
    if (script.split(direct).length !== 2) throw new Error('Desktop trusted runtime entry changed');
    return script.replace(direct, interpreted);
  };
  const configuration = desktopConfigScript(preferences).match(/<<'SAKURA_PREFERENCES'\n([\s\S]*?)\nSAKURA_PREFERENCES/)![1];
  let session = transform(body('SAKURA_SESSION'));
  // /run can be mounted noexec. The generated session already enters via
  // /bin/sh; Plasma and layout must use the same interpreter entry.
  session = session.replace('export DISPLAY=:1 XDG_RUNTIME_DIR=$SAKURA_DESKTOP_RUNTIME', 'export DISPLAY=:1 XDG_RUNTIME_DIR="$SAKURA_DESKTOP_RUNTIME"')
    .replace('export XAUTHORITY=$SAKURA_DESKTOP_RUNTIME/Xauthority', 'export XAUTHORITY="$SAKURA_DESKTOP_RUNTIME/Xauthority"');
  session = interpreterEntry(session, 'dbus-run-session -- $SAKURA_DESKTOP_RUNTIME/plasma-session',
    'dbus-run-session -- /bin/sh "$SAKURA_DESKTOP_RUNTIME/plasma-session"');
  // Generated UID paths are quoted, including native HOMEs with UUID names.
  // Native HOME/runtime names contain only the fixed administrator prefix and
  // UUIDs. Keep the original embedded Plasma JavaScript quoting intact.
  const plasma = interpreterEntry(transform(body('SAKURA_PLASMA')), '$SAKURA_DESKTOP_RUNTIME/apply-layout &',
    '/bin/sh "$SAKURA_DESKTOP_RUNTIME/apply-layout" &');
  const layout = transform(body('SAKURA_LAYOUT'));
  const wallpapers = [['SAKURA_WALLPAPER', 'sakura'], ['MIDNIGHT_WALLPAPER', 'midnight'], ['PAPER_WALLPAPER', 'paper']]
    .map(([marker, name]) => `cat > "$HOME/.local/share/wallpapers/${name}.svg" <<'${marker}'\n${body(marker)}\n${marker}`).join('\n');
  return `set -eu\numask 077\nexport SAKURA_DESKTOP_RUNTIME=${quote('/run/sakura-desktop-uid/' + uid + '/' + runId)}\n` +
    `test "$(id -u)" = ${uid}\ntest -d "$SAKURA_DESKTOP_RUNTIME" && test ! -L "$SAKURA_DESKTOP_RUNTIME"\n` +
    `test "$(stat -c %u "$SAKURA_DESKTOP_RUNTIME")" = ${uid}\ntest "$(stat -c %a "$SAKURA_DESKTOP_RUNTIME")" = 700\n` +
    'mkdir -p "$HOME/.config" "$HOME/.local/share/wallpapers"\n' +
    `cat > "$SAKURA_DESKTOP_RUNTIME/preferences" <<'SAKURA_UID_PREFERENCES'\n${configuration}\nSAKURA_UID_PREFERENCES\n` +
    `cat > "$SAKURA_DESKTOP_RUNTIME/session" <<'SAKURA_UID_SESSION'\n${session}\nSAKURA_UID_SESSION\n` +
    `cat > "$SAKURA_DESKTOP_RUNTIME/plasma-session" <<'SAKURA_UID_PLASMA'\n${plasma}\nSAKURA_UID_PLASMA\n` +
    `cat > "$SAKURA_DESKTOP_RUNTIME/apply-layout" <<'SAKURA_UID_LAYOUT'\n${layout}\nSAKURA_UID_LAYOUT\n` +
    `${wallpapers}\nchmod 700 "$SAKURA_DESKTOP_RUNTIME/session" "$SAKURA_DESKTOP_RUNTIME/plasma-session" "$SAKURA_DESKTOP_RUNTIME/apply-layout"\n` +
    'exec /bin/sh "$SAKURA_DESKTOP_RUNTIME/session"';
}

export function desktopProjectEnvironment(environment: Record<string, string> = {}) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(?:HOME$|USER$|LOGNAME$|SAKURA_DESKTOP_|DISPLAY$|XAUTHORITY$|DBUS_|WAYLAND_|XDG_RUNTIME_DIR$|SESSION_MANAGER$)/.test(key)));
}

/** Packages and system adapters never receive project cwd, PATH, environment or hooks. */
export function desktopProjectPrepare(distro: string, input: DesktopPreferences) {
  desktopPreferencesSchema.parse(input);
  const packages = distro === 'alpine' ? desktopInstall.match(/apk add --no-cache[\s\S]*?xauth xdpyinfo xrandr python3 iproute2 setpriv/)![0] + ' tmux iptables' :
    aptPrepare([...desktopDebianPackages, 'tmux', 'iptables']);
  const wrapper = desktopInstall.match(/<<'SAKURA_KWIN'\n([\s\S]*?)\nSAKURA_KWIN/)![1];
  const adapter = `import os,stat,tempfile\nfrom pathlib import Path\n` +
    `for path in ['/etc','/usr','/usr/local','/usr/local/libexec','/usr/local/libexec/sakura-plasma']:\n` +
    ` try: os.mkdir(path,0o755)\n except FileExistsError: pass\n` +
    ` info=os.lstat(path)\n assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\n` +
    `def publish(path,data,mode):\n` +
    ` if os.path.lexists(path):\n  info=os.lstat(path)\n  assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022 and info.st_nlink==1\n` +
    ` fd,temporary=tempfile.mkstemp(dir=os.path.dirname(path),prefix='.desktop-project-')\n` +
    ` try:\n  with os.fdopen(fd,'wb') as stream:\n   stream.write(data);stream.flush();os.fchmod(stream.fileno(),mode);os.fsync(stream.fileno())\n` +
    `  os.replace(temporary,path)\n finally:\n  if os.path.lexists(temporary):os.unlink(temporary)\n` +
    ` os.sync()\n` +
    `publish('/usr/local/libexec/sakura-plasma/kwin_wayland_wrapper',${JSON.stringify(wrapper)}.encode(),0o755)\n` +
    `publish('/etc/sakura-desktop-project-version',b'1\\n',0o644)\n`;
  const script = 'set -eu\ncd /\n' + packages + '\n/usr/bin/python3 -I -S -c ' + quote(adapter) + '\n' +
    (distro === 'alpine' ? 'rc-service dbus start' : 'systemctl start dbus');
  return `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ${quote(script)}`;
}

export const desktopProjectVersionProbe = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ' +
  quote("grep -qx '1' /etc/sakura-desktop-project-version && test -x /usr/bin/tmux && command -v iptables >/dev/null && (command -v startplasma-x11 >/dev/null || command -v startplasma-wayland >/dev/null)");
