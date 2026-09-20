// These scripts run only inside the managed Alpine guest, over its existing SSH connection.
export const desktopProbe = String.raw`if [ ! -f /etc/sakura/desktop-version ]; then
  printf 'not-installed\n'
elif rc-service sakura-desktop status >/dev/null 2>&1; then
  if pgrep -u sakura-desktop -x xfce4-session >/dev/null && pgrep -u sakura-desktop -x xfwm4 >/dev/null && pgrep -u sakura-desktop -x xfdesktop >/dev/null; then
    printf 'ready\n'
  else
    printf 'starting\n'
  fi
else
  printf 'stopped\n'
fi`;

export const desktopStart = String.raw`set -eu
test -f /etc/sakura/desktop-version
rc-service dbus start
rc-service sakura-desktop restart
for attempt in $(seq 1 90); do
  if pgrep -u sakura-desktop -x xfce4-session >/dev/null && pgrep -u sakura-desktop -x xfwm4 >/dev/null && pgrep -u sakura-desktop -x xfdesktop >/dev/null; then exit 0; fi
  sleep 1
done
tail -c 8192 /var/log/sakura-desktop.log
exit 1`;

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
echo 'Installing Xfce and TigerVNC. The first installation needs internet access.'
apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/v3.23/community \
  xfce4 xfce4-terminal tigervnc dbus dbus-x11 dbus-openrc font-dejavu font-noto-cjk xauth xdpyinfo
if ! id sakura-desktop >/dev/null 2>&1; then
  adduser -D -h /home/sakura-desktop -s /bin/sh sakura-desktop
fi
test "$(id -u sakura-desktop)" != 0
test "$(awk -F: '$1 == "sakura-desktop" { print $6 }' /etc/passwd)" = /home/sakura-desktop
cat > /usr/local/libexec/sakura-desktop-session <<'SAKURA_SESSION'
#!/bin/sh
set -eu
export DISPLAY=:1 XDG_RUNTIME_DIR=/run/sakura-desktop
export XAUTHORITY=/run/sakura-desktop/Xauthority
unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS
[ ! -f /home/sakura-desktop/.sakura-ime ] || . /home/sakura-desktop/.sakura-ime
xauth -f "$XAUTHORITY" add :1 . "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
Xvnc :1 -geometry 1280x800 -depth 24 -rfbport 5901 -interface 127.0.0.1 \
  -localhost -SecurityTypes None -AlwaysShared -nolisten tcp -auth "$XAUTHORITY" &
vnc_pid=$!
session_pid=''
cleanup() {
  trap - EXIT HUP INT TERM
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
dbus-run-session -- xfce4-session &
session_pid=$!
wait "$session_pid"
SAKURA_SESSION
chmod 755 /usr/local/libexec/sakura-desktop-session
cat > /etc/init.d/sakura-desktop <<'SAKURA_SERVICE'
#!/sbin/openrc-run
description="Sakura Xfce desktop over SSH"
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
# Disable compositing for the software-rendered desktop, preserving later user preferences.
settings=/home/sakura-desktop/.config/xfce4/xfconf/xfce-perchannel-xml
mkdir -p "$settings"
if [ ! -e "$settings/xfwm4.xml" ]; then
  cat > "$settings/xfwm4.xml" <<'SAKURA_XFWM'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfwm4" version="1.0"><property name="general" type="empty"><property name="use_compositing" type="bool" value="false"/></property></channel>
SAKURA_XFWM
fi
chown -R sakura-desktop:sakura-desktop /home/sakura-desktop/.config
rc-update add dbus default
rc-update add sakura-desktop default
printf '1\n' > /etc/sakura/desktop-version
echo 'Starting the desktop session…'
` +
  desktopStart +
  String.raw`
echo 'Xfce desktop is ready.'
SAKURA_INSTALL`;

export function desktopCommands(distro = 'alpine') {
  if (distro === 'alpine') return { probe: desktopProbe, start: desktopStart, install: desktopInstall };
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
Description=Sakura Xfce desktop
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
  const install = desktopInstall
    .replace(/case "\$\(cat \/etc\/alpine-release\)" in[\s\S]*?esac/, '')
    .replace(
      /apk add --no-cache[\s\S]*?xauth xdpyinfo/,
      'export DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends xfce4 xfce4-terminal tigervnc-standalone-server dbus-x11 fonts-dejavu fonts-noto-cjk xauth x11-utils netcat-openbsd',
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
  return { probe, start, install };
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
