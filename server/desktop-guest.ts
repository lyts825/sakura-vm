import {
  defaultDesktopPreferences,
  desktopPreferencesSchema,
  type DesktopPreferences,
} from './desktop-preferences.ts';

// These scripts run only inside the managed guest, over its existing SSH connection.
// TigerVNC owns the outer X server. Wayland-only distros nest KWin inside it.
// BusyBox pgrep matches argv[0], which KDE launches with an absolute path.
const plasmaReady =
  "test -f /run/sakura-desktop/ready && pgrep -u sakura-desktop -f '(^|/)plasmashell( |$)' >/dev/null 2>&1 && pgrep -u sakura-desktop -f '(^|/)kwin_(x11|wayland)( |$)' >/dev/null 2>&1 && timeout 3 env DISPLAY=:1 XAUTHORITY=/run/sakura-desktop/Xauthority xdpyinfo >/dev/null 2>&1";
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

function desktopConfigScript(input: DesktopPreferences) {
  const p = desktopPreferencesSchema.parse(input);
  const factor = (p.scale / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(p.accent.slice(offset, offset + 2), 16)).join(',');
  return String.raw`mkdir -p /etc/sakura
cat > /etc/sakura/desktop-preferences <<'SAKURA_PREFERENCES'
DESKTOP=kde-plasma
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
  kquickcharts kpipewire tzdata font-dejavu font-noto-cjk xauth xdpyinfo xrandr
if ! id sakura-desktop >/dev/null 2>&1; then
  adduser -D -h /home/sakura-desktop -s /bin/sh sakura-desktop
fi
test "$(id -u sakura-desktop)" != 0
test "$(awk -F: '$1 == "sakura-desktop" { print $6 }' /etc/passwd)" = /home/sakura-desktop
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
export RESOLUTION MONITOR_LAYOUT QT_SCALE_FACTOR THEME ACCENT PANEL AUTO_HIDE_PANEL ANIMATIONS WALLPAPER ACCENT_RGB
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
exec /usr/bin/kwin_wayland_wrapper "$@" --x11-display :1 --width "$(printf '%s' "$FRAMEBUFFER" | cut -dx -f1)" --height "$(printf '%s' "$FRAMEBUFFER" | cut -dx -f2)" --no-lockscreen
SAKURA_KWIN
chmod 755 /usr/local/libexec/sakura-plasma/kwin_wayland_wrapper
cat > /usr/local/libexec/sakura-plasma-session <<'SAKURA_PLASMA'
#!/bin/sh
set -eu
/usr/local/libexec/sakura-apply-layout &
if command -v startplasma-x11 >/dev/null 2>&1; then
  export XDG_SESSION_TYPE=x11
  exec startplasma-x11
elif command -v startplasma-wayland >/dev/null 2>&1; then
  export PATH=/usr/local/libexec/sakura-plasma:$PATH
  export XDG_SESSION_TYPE=wayland KWIN_COMPOSE=QPainter
  exec startplasma-wayland
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
command="/bin/su"
command_args="-l sakura-desktop -s /bin/sh -c /usr/local/libexec/sakura-desktop-session"
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
rc-update add sakura-desktop default
printf '3\n' > /etc/sakura/desktop-version
echo 'Starting the desktop session…'
` +
  desktopStart +
  String.raw`
echo 'KDE Plasma desktop is ready.'
SAKURA_INSTALL`;

export function desktopCommands(distro = 'alpine', input = defaultDesktopPreferences) {
  const preferences = desktopPreferencesSchema.parse(input);
  const startWithPreferences = (start: string, install: string) => String.raw`set -eu
if ! grep -qx '3' /etc/sakura/desktop-version 2>/dev/null; then
${install}
else
${desktopConfigScript(preferences)}
${start}
fi`;
  const configure = (start: string, install: string) => String.raw`set -eu
test -f /etc/sakura/desktop-version
if ! grep -qx '3' /etc/sakura/desktop-version; then
  echo 'Upgrading KDE Plasma desktop for logical monitors…'
${install}
else
${desktopConfigScript(preferences)}
echo 'Applying KDE Plasma preferences and restarting the desktop session…'
${start}
fi
echo 'KDE Plasma preferences applied.'`;
  const customizedInstall = desktopInstall.replace(
    desktopConfigScript(defaultDesktopPreferences),
    desktopConfigScript(preferences),
  );
  if (distro === 'alpine')
    return {
      probe: desktopProbe,
      preferencesProbe: desktopPreferencesProbe,
      start: desktopStart,
      startWithPreferences: startWithPreferences(desktopStart, customizedInstall),
      install: customizedInstall,
      configure: configure(desktopStart, customizedInstall),
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
User=sakura-desktop
Group=sakura-desktop
RuntimeDirectory=sakura-desktop
RuntimeDirectoryMode=0700
ExecStart=/usr/local/libexec/sakura-desktop-session
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
      /apk add --no-cache[\s\S]*?xauth xdpyinfo xrandr/,
      'export DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends kde-plasma-desktop systemsettings breeze breeze-icon-theme konsole dolphin tigervnc-standalone-server dbus-x11 fonts-dejavu fonts-noto-cjk xauth x11-utils x11-xserver-utils netcat-openbsd',
    )
    .replace(
      'adduser -D -h /home/sakura-desktop -s /bin/sh sakura-desktop',
      'useradd --user-group --create-home --home-dir /home/sakura-desktop --shell /bin/sh sakura-desktop',
    )
    .replace('Xvnc :1', 'Xtigervnc :1')
    .replace(/cat > \/etc\/init.d\/sakura-desktop[\s\S]*?chmod 755 \/etc\/init.d\/sakura-desktop/, unit)
    .replace(
      'rc-update add dbus default\nrc-update add sakura-desktop default',
      'systemctl daemon-reload\nsystemctl enable sakura-desktop',
    )
    .replace(desktopStart, start);
  return {
    probe,
    preferencesProbe: desktopPreferencesProbe,
    start,
    startWithPreferences: startWithPreferences(start, install),
    install,
    configure: configure(start, install),
    preferences,
  };
}

export function imeInstall(distro = 'alpine') {
  const install =
    distro === 'alpine'
      ? 'apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/v3.23/community fcitx5 fcitx5-chinese-addons fcitx5-gtk fcitx5-qt'
      : 'export DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y fcitx5 fcitx5-chinese-addons fcitx5-frontend-gtk3 fcitx5-frontend-qt5';
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
