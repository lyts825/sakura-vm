export type RecordingEntry = {
  id: string;
  vmId: string;
  vmName: string;
  name: string;
  createdAt: string;
  bytes: number;
  milliseconds: number;
  width: number;
  height: number;
  mime: string;
};
export const libraryLimits = { bytes: 256 * 1024 ** 2, count: 32 };
const databaseName = 'sakura-desktop-recordings-v1';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('此浏览器不支持录制库，仍可下载录制文件'));
      return;
    }
    let settled = false;
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('index', { keyPath: 'id' });
      request.result.createObjectStore('content');
    };
    request.onerror = () => {
      settled = true;
      reject(new Error('浏览器无法打开录制库'));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error('录制库正在升级，请关闭其他 Sakura 标签页后重试'));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function checked(entry: RecordingEntry) {
  if (
    !entry ||
    !/^[a-f0-9-]{36}$/.test(entry.id) ||
    !/^[a-f0-9-]{36}$/.test(entry.vmId) ||
    typeof entry.name !== 'string' ||
    !entry.name.trim() ||
    entry.name.length > 100 ||
    typeof entry.vmName !== 'string' ||
    entry.vmName.length > 32 ||
    !Number.isFinite(Date.parse(entry.createdAt)) ||
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes <= 0 ||
    entry.bytes > 128 * 1024 ** 2 ||
    !Number.isFinite(entry.milliseconds) ||
    entry.milliseconds < 0 ||
    entry.milliseconds > 7 * 86400000 ||
    !Number.isInteger(entry.width) ||
    entry.width < 1 ||
    entry.width > 1920 ||
    !Number.isInteger(entry.height) ||
    entry.height < 1 ||
    entry.height > 1080 ||
    !/^video\/webm(?:;codecs=vp[89])?$/.test(entry.mime)
  )
    throw new Error('录制索引损坏');
  return entry;
}
export async function listRecordings(): Promise<RecordingEntry[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('index', 'readonly'),
        request = tx.objectStore('index').getAll();
      tx.onabort = () => reject(new Error('无法读取录制库'));
      tx.oncomplete = () => {
        try {
          resolve(
            request.result
              .map(checked)
              .sort((a: RecordingEntry, b: RecordingEntry) => b.createdAt.localeCompare(a.createdAt)),
          );
        } catch (error) {
          reject(error);
        }
      };
    });
  } finally {
    db.close();
  }
}
export async function saveRecording(entry: RecordingEntry, blob: Blob): Promise<void> {
  checked(entry);
  if (blob.size !== entry.bytes || blob.type !== entry.mime) throw new Error('录制内容与索引不一致');
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['index', 'content'], 'readwrite');
      let error = '保存失败，浏览器空间可能不足；仍可下载此次录制';
      const index = tx.objectStore('index');
      index.getAll().onsuccess = (event) => {
        try {
          const rows = (event.target as IDBRequest).result.map(checked) as RecordingEntry[];
          if (rows.some((row) => row.id === entry.id)) throw new Error('此录制已经保存');
          if (
            rows.length >= libraryLimits.count ||
            rows.reduce((sum, row) => sum + row.bytes, 0) + blob.size > libraryLimits.bytes
          )
            throw new Error('录制库已满（32 条或 256 MiB），请先删除不需要的录制，或直接下载');
          index.add(entry);
          tx.objectStore('content').add(blob, entry.id);
        } catch (e) {
          if ((e as Error).name !== 'QuotaExceededError') error = (e as Error).message;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error(error));
    });
  } finally {
    db.close();
  }
}
export async function recordingBlob(entry: RecordingEntry): Promise<Blob> {
  checked(entry);
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('content', 'readonly'),
        request = tx.objectStore('content').get(entry.id);
      tx.onabort = () => reject(new Error('无法读取录制内容'));
      tx.oncomplete = () => {
        const blob = request.result;
        if (!(blob instanceof Blob) || blob.size !== entry.bytes || blob.type !== entry.mime)
          reject(new Error('录制内容缺失或已损坏'));
        else resolve(blob);
      };
    });
  } finally {
    db.close();
  }
}
export async function deleteRecording(id: string): Promise<void> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的录制标识');
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['index', 'content'], 'readwrite');
      tx.objectStore('index').delete(id);
      tx.objectStore('content').delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('无法删除录制'));
    });
  } finally {
    db.close();
  }
}
export async function clearRecordings(): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['index', 'content'], 'readwrite');
      tx.objectStore('index').clear();
      tx.objectStore('content').clear();
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('无法清空录制库'));
    });
  } finally {
    db.close();
  }
}
