/** 浏览器扩展弹窗：配对本机只读凭据、刷新实例清单，并在撤销或遗忘时清除本地凭据。 */
const element = (id) => document.getElementById(id);
const status = element('status');
const pairForm = element('pair-form');
const inventory = element('inventory');
const portInput = element('port');
const codeInput = element('code');
const vmList = element('vms');
let connection = { port: 7337, token: '' };
let refreshVersion = 0;
let pairing = false;
const pairButton = pairForm.querySelector('button[type="submit"]');

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function show(connected) {
  pairForm.hidden = connected;
  inventory.hidden = !connected;
}

function endpoint(path, current) {
  return `http://127.0.0.1:${current.port}/api/extension/${path}`;
}

async function request(path, method = 'GET', data, current = connection) {
  const response = await fetch(endpoint(path, current), {
    method,
    cache: 'no-store',
    headers: {
      'X-Sakura-Extension-Origin': `chrome-extension://${chrome.runtime.id}`,
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(current.token ? { 'X-Sakura-Extension-Token': current.token } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function renderVms(vms) {
  vmList.replaceChildren();
  if (!vms.length) {
    const empty = document.createElement('p');
    empty.textContent = '还没有实例。';
    vmList.append(empty);
    return;
  }
  for (const vm of vms) {
    const row = document.createElement('div');
    row.className = 'vm';
    const name = document.createElement('strong');
    name.textContent = vm.name;
    const details = document.createElement('span');
    details.textContent = `${vm.status} · ${vm.cpus} CPU · ${vm.memoryMiB} MiB · ${vm.diskGiB} GiB`;
    row.append(name, details);
    vmList.append(row);
  }
}

async function refresh() {
  if (!connection.token) return;
  // 配对/遗忘可能在请求期间切换连接；对象身份与刷新序号共同拒绝旧响应覆盖新状态。
  const current = connection;
  const version = ++refreshVersion;
  show(true);
  message('正在连接…');
  try {
    const result = await request('inventory', 'GET', undefined, current);
    if (connection !== current || version !== refreshVersion) return;
    renderVms(result.vms);
    show(true);
    message(`已连接 · ${result.vms.length} 台实例`);
  } catch (error) {
    if (connection !== current || version !== refreshVersion) return;
    if (error.status === 401 || error.status === 403) {
      const cleared = connection = { port: current.port, token: '' };
      vmList.replaceChildren();
      show(false);
      try {
        await chrome.storage.local.remove('token');
      } catch (storageError) {
        if (connection === cleared) message(storageError.message || '无法清除扩展设置。', true);
        return;
      }
      if (connection !== cleared) return;
      message(`连接已失效，请重新配对：${error.message}`, true);
    } else {
      message(error.message || '无法连接 Sakura。', true);
    }
  }
}

pairForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pairing) return;
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    message('端口必须在 1–65535 之间。', true);
    return;
  }
  pairing = true;
  pairButton.disabled = true;
  const current = connection = { port, token: '' };
  let owned = current;
  message('正在配对…');
  try {
    const result = await request('connect', 'POST', { code: codeInput.value.trim() }, current);
    if (connection !== current) return;
    const paired = connection = { port, token: result.token };
    owned = paired;
    await chrome.storage.local.set({ port, token: result.token });
    if (connection !== paired) return;
    codeInput.value = '';
    await refresh();
  } catch (error) {
    if (connection === owned) message(error.message || '配对失败。', true);
  } finally {
    pairing = false;
    pairButton.disabled = false;
  }
});

element('refresh').addEventListener('click', () => void refresh());
element('open').addEventListener('click', () =>
  chrome.tabs.create({ url: `http://127.0.0.1:${connection.port}/` }));
element('forget').addEventListener('click', async () => {
  const current = connection = { port: connection.port, token: '' };
  vmList.replaceChildren();
  show(false);
  try {
    await chrome.storage.local.remove('token');
    if (connection === current) message('本地凭证已清除。管理员可在 Sakura 中撤销配对。');
  } catch (error) {
    if (connection === current) message(error.message || '无法清除扩展设置。', true);
  }
});

void (async () => {
  const stored = await chrome.storage.local.get(['port', 'token']);
  connection = {
    port: Number.isInteger(stored.port) && stored.port >= 1 && stored.port <= 65535 ? stored.port : 7337,
    token: typeof stored.token === 'string' ? stored.token : '',
  };
  portInput.value = String(connection.port);
  if (connection.token) await refresh();
  else { show(false); message('尚未配对。'); }
})().catch((error) => message(error.message || '无法读取扩展设置。', true));
