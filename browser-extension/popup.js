/** 浏览器扩展弹窗：配对本机只读凭据、刷新实例清单，并在撤销或遗忘时清除本地凭据。
 * Pair a local read-only credential, refresh VM inventory and clear local credentials after revocation or forgetting, rejecting stale responses across connection changes. */
/** 按元素 ID 获取配对界面的现有 DOM 节点，未知 ID 返回 null，调用方使用页面固定结构。
 * Look up an existing pairing UI element by ID; unknown IDs return null and callers rely on the fixed popup markup. */
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

/** 以纯文本更新连接反馈，并按 error 参数切换错误样式；不解析服务器返回的 HTML。
 * Write connection feedback as plain text and toggle the error style from the error argument; server text is never parsed as HTML. */
function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

/** 根据是否已连接切换配对表单和只读清单的可见性，不改变凭据本身。
 * Switch the pairing form and read-only inventory visibility according to connection state without mutating credentials. */
function show(connected) {
  pairForm.hidden = connected;
  inventory.hidden = !connected;
}

/** 把相对扩展 API 路径绑定到 current 中已选端口的 IPv4 回环地址，防止把扩展令牌发送到远端。
 * Bind an extension API path to the selected port on IPv4 loopback so extension tokens are sent only to the local service. */
function endpoint(path, current) {
  return `http://127.0.0.1:${current.port}/api/extension/${path}`;
}

/** 向选定连接发起最长 10 秒且禁用缓存的 JSON 请求，携带扩展来源和可选令牌；非成功响应抛出含 HTTP 状态的错误供撤销处理。
 * Issue a noncached JSON request with a ten-second deadline, extension origin and optional token; unsuccessful responses throw an error carrying the HTTP status for revocation handling. */
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

/** 替换实例清单，显示名称、状态和资源数量；所有服务数据均写入 textContent，空数组显示空状态。
 * Replace the inventory with VM names, states and resource counts; all service data uses textContent and an empty array shows an empty state. */
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

/** 采样只读清单；用连接对象身份和递增序号拒绝过期响应。仅当前请求的 401/403 清除本地令牌，其他失败保留连接并显示原因。
 * Sample the read-only inventory; connection identity and a monotonic request version reject stale responses. Only a current 401/403 clears the local token, while other failures retain the connection and display the reason. */
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

pairForm.addEventListener('submit', /** 序列化一次配对提交，校验回环端口后交换短码并存储令牌；每次 await 后比较连接对象，撤销或新配对可使旧回应失效，finally 恢复按钮。
 * Serialize pairing submission, validate the loopback port, exchange the short code and persist the token; compare connection identity after awaits so revocation/new pairing invalidates stale replies, restoring the button in finally. */ async (event) => {
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
/** 清除内存凭据和清单后再删存储令牌，立即使所有旧异步回应失效；仅当前连接显示清除结果，远端授权由管理员撤销。
 * Clear in-memory credentials/inventory before deleting the stored token, immediately invalidating old asynchronous replies; display feedback only for the current connection, while administrators revoke server-side grants. */
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

/** 读取本地设置并重新校验回环端口/令牌类型，合法凭据只用于新采样；存储失败由外层 catch 显示，不能据此宣称已连接。
 * Read stored settings and revalidate loopback port/token types, using valid credentials only for a fresh sample; outer catch reports storage failure without claiming a connection. */
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
