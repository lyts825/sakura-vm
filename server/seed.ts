import { generateKeyPairSync, randomBytes } from 'node:crypto';

const field = (b: Buffer) => {
  const n = Buffer.alloc(4);
  n.writeUInt32BE(b.length);
  return Buffer.concat([n, b]);
};
export function createSshKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const jwk = publicKey.export({ format: 'jwk' });
  const mpint = (s: string) => {
    const b = Buffer.from(s, 'base64url');
    return field(b[0] & 128 ? Buffer.concat([Buffer.from([0]), b]) : b);
  };
  const publicText =
    'ssh-rsa ' +
    Buffer.concat([field(Buffer.from('ssh-rsa')), mpint(jwk.e!), mpint(jwk.n!)]).toString('base64') +
    ' sakura';
  return { privateText: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), publicText };
}

// Minimal ISO 9660 Level 2 seed. Linux's default ISO name mapping lowercases
// USER-DATA.;1 and strips the version, exposing the names NoCloud expects.
export function seedIso(files: Record<string, string>) {
  const sector = 2048;
  const entries = Object.entries(files).map(([name, text]) => ({
    name: `${name.toUpperCase()}.;1`,
    data: Buffer.from(text),
    block: 0,
  }));
  let next = 21;
  for (const e of entries) {
    e.block = next;
    next += Math.ceil(e.data.length / sector) || 1;
  }
  const iso = Buffer.alloc(next * sector);
  const both32 = (b: Buffer, o: number, v: number) => {
    b.writeUInt32LE(v, o);
    b.writeUInt32BE(v, o + 4);
  };
  const both16 = (b: Buffer, o: number, v: number) => {
    b.writeUInt16LE(v, o);
    b.writeUInt16BE(v, o + 2);
  };
  function record(name: Buffer, block: number, size: number, dir = false) {
    const b = Buffer.alloc(33 + name.length + (name.length % 2 === 0 ? 1 : 0));
    b[0] = b.length;
    both32(b, 2, block);
    both32(b, 10, size);
    Buffer.from([126, 1, 1, 0, 0, 0, 0]).copy(b, 18);
    b[25] = dir ? 2 : 0;
    both16(b, 28, 1);
    b[32] = name.length;
    name.copy(b, 33);
    return b;
  }
  const pvd = iso.subarray(16 * sector, 17 * sector);
  pvd[0] = 1;
  pvd.write('CD001', 1);
  pvd[6] = 1;
  pvd.fill(32, 8, 72);
  pvd.write('SAKURA', 8);
  pvd.write('CIDATA', 40);
  both32(pvd, 80, next);
  both16(pvd, 120, 1);
  both16(pvd, 124, 1);
  both16(pvd, 128, sector);
  both32(pvd, 132, 10);
  pvd.writeUInt32LE(18, 140);
  pvd.writeUInt32BE(19, 148);
  record(Buffer.from([0]), 20, sector, true).copy(pvd, 156);
  pvd.fill(32, 190, 813);
  pvd[881] = 1;
  for (const off of [813, 830, 847, 864]) pvd.write('2026010100000000', off);
  const end = iso.subarray(17 * sector);
  end[0] = 255;
  end.write('CD001', 1);
  end[6] = 1;
  for (const [index, big] of [
    [18, false],
    [19, true],
  ] as const) {
    const path = iso.subarray(index * sector);
    path[0] = 1;
    if (big) {
      path.writeUInt32BE(20, 2);
      path.writeUInt16BE(1, 6);
    } else {
      path.writeUInt32LE(20, 2);
      path.writeUInt16LE(1, 6);
    }
  }
  let at = 20 * sector;
  for (const b of [
    record(Buffer.from([0]), 20, sector, true),
    record(Buffer.from([1]), 20, sector, true),
    ...entries.map((e) => record(Buffer.from(e.name), e.block, e.data.length)),
  ]) {
    b.copy(iso, at);
    at += b.length;
  }
  for (const e of entries) e.data.copy(iso, e.block * sector);
  return iso;
}

export const guestNetwork = `auto lo
iface lo inet loopback

auto eth0
iface eth0 inet static
  address 10.0.2.15/24
  gateway 10.0.2.2
`;

export const cloudNetwork = `version: 2
ethernets:
  sakura:
    match:
      name: "e*"
    dhcp4: true
    dhcp6: true
    accept-ra: true
`;

export function cloudUserData(name: string, publicKey: string,
  serialDevice: '/dev/ttyS0' | '/dev/ttyAMA0' = '/dev/ttyS0') {
  return `#cloud-config
hostname: ${name}
manage_etc_hosts: true
disable_root: false
ssh_pwauth: false
users:
  - name: root
    lock_passwd: false
    hashed_passwd: '$6$sakura$${randomBytes(64).toString('base64').replaceAll('+', '.').replaceAll('=', '')}'
    ssh_authorized_keys:
      - ${publicKey}
write_files:
  - path: /etc/ssh/sshd_config.d/00-sakura.conf
    permissions: '0600'
    content: |
      PermitRootLogin prohibit-password
      PasswordAuthentication no
  - path: /etc/profile.d/sakura.sh
    content: |
      export TERM=xterm-256color
runcmd:
  - [mkdir, -p, /workspace]
  - [systemctl, restart, ssh]
  - [sh, -c, "printf 'SAKURA_READY\\n' > ${serialDevice}"]
`;
}

// Every VM has its own QEMU user-mode network, so these addresses never compete
// with another VM. Supplying ENI metadata avoids dhcpcd's discovery/probe delay.
export function metaData(id: string, name: string, publicKey: string) {
  return `instance-id: ${id}
local-hostname: ${name}
public-keys:
  - ${publicKey}
network-interfaces: |
${guestNetwork
  .trimEnd()
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
resolv_conf:
  nameservers:
    - 10.0.2.3
`;
}

// Only migrate the stock Alpine settings. Custom boot timeouts, DNS and network
// configurations remain under the guest user's control. Changes apply next boot.
export function bootSetup() {
  return `if [ ! -e /etc/sakura/keep-boot-config ]; then
if [ -f /etc/update-extlinux.conf ] && [ ! -L /etc/update-extlinux.conf ] && grep -qx 'timeout=10' /etc/update-extlinux.conf; then
  [ -e /etc/update-extlinux.conf.sakura-backup ] || cp -p /etc/update-extlinux.conf /etc/update-extlinux.conf.sakura-backup
  sed -i 's/^timeout=10$/timeout=1/' /etc/update-extlinux.conf
fi
if [ -f /boot/extlinux.conf ] && [ ! -L /boot/extlinux.conf ] && grep -qx 'TIMEOUT 100' /boot/extlinux.conf; then
  [ -e /boot/extlinux.conf.sakura-backup ] || cp -p /boot/extlinux.conf /boot/extlinux.conf.sakura-backup
  sed -i 's/^TIMEOUT 100$/TIMEOUT 10/' /boot/extlinux.conf
fi
if [ -f /etc/network/interfaces ] && [ ! -L /etc/network/interfaces ] && [ ! -L /etc/resolv.conf ] && grep -qx 'nameserver 10.0.2.3' /etc/resolv.conf; then
  current=$(awk 'NF && $1 !~ /^#/ { $1=$1; print }' /etc/network/interfaces)
  if [ "$current" = 'auto lo
iface lo inet loopback
auto eth0
iface eth0 inet dhcp' ]; then
    [ -e /etc/network/interfaces.sakura-backup ] || cp -p /etc/network/interfaces /etc/network/interfaces.sakura-backup
    cat > /etc/network/interfaces <<'SAKURA_NETWORK'
${guestNetwork}SAKURA_NETWORK
  fi
fi
if [ -f /etc/conf.d/chronyd ] && [ ! -L /etc/conf.d/chronyd ] && grep -qx 'FAST_STARTUP=no' /etc/conf.d/chronyd; then
  [ -e /etc/conf.d/chronyd.sakura-backup ] || cp -p /etc/conf.d/chronyd /etc/conf.d/chronyd.sakura-backup
  sed -i 's/^FAST_STARTUP=no$/FAST_STARTUP=yes/' /etc/conf.d/chronyd
fi
# Tiny Cloud is only needed to provision a fresh disk. Leaving its four
# OpenRC hooks enabled makes every later boot wait through the cloud phases
# again, even though the instance already has its persistent configuration.
# Remove the hooks after provisioning so the next boot can go straight from
# networking to sshd. These commands are best-effort for older Alpine images.
if command -v rc-update >/dev/null 2>&1; then
  rc-update del tiny-cloud-boot boot >/dev/null 2>&1 || true
  rc-update del tiny-cloud-early default >/dev/null 2>&1 || true
  rc-update del tiny-cloud-main default >/dev/null 2>&1 || true
  rc-update del tiny-cloud-final default >/dev/null 2>&1 || true
fi
fi
true`;
}

export function userData(name: string, publicKey: string) {
  return `#!/bin/sh
set -eu
${bootSetup()}
hostname ${name}
printf '%s\n' '${name}' > /etc/hostname
mkdir -p /root/.ssh /workspace
chmod 700 /root/.ssh
cat > /root/.ssh/authorized_keys <<'SAKURA_KEY'
${publicKey}
SAKURA_KEY
chmod 600 /root/.ssh/authorized_keys
# Public-key authentication only. No shared or blank login password.
sed -i '/^PermitRootLogin /d; /^PasswordAuthentication /d; /^Subsystem sftp /d' /etc/ssh/sshd_config
printf '\nPermitRootLogin prohibit-password\nPasswordAuthentication no\nSubsystem sftp internal-sftp\n' >> /etc/ssh/sshd_config
# Unlock the account with a random, unguessable crypt value for public-key login.
sed -i 's|^root:[^:]*:|root:$6$sakura$${randomBytes(64).toString('base64').replaceAll('+', '.').replaceAll('=', '')}:|' /etc/shadow
cat > /etc/profile.d/sakura.sh <<'SAKURA_PROFILE'
export TERM=xterm-256color
export PS1='\\[\\033[38;5;209m\\]\\u@\\h\\[\\033[0m\\]:\\w\\$ '
SAKURA_PROFILE
cat > /etc/motd <<'SAKURA_MOTD'

  Welcome to Sakura.
  Your Linux workspace is ready.  /workspace

SAKURA_MOTD
rc-service sshd restart
# Persist the key, hostname and OpenRC changes before acknowledging readiness.
/bin/sync
printf 'SAKURA_READY\n' > /dev/ttyS0
`;
}
