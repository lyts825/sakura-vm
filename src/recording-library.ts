/**
 * 模块职责（中文）：以 IndexedDB 保存桌面录制元数据和 Blob，校验记录并执行录制库容量约束。
 * Module responsibility (English): Saving recording indexes and content in a single IndexedDB transaction.
 * 详细范围（中文）：公开入口包括 RecordingEntry, libraryLimits, listRecordings, saveRecording, recordingBlob, deleteRecording, clearRecordings；职责覆盖在单一 IndexedDB 事务中保存录制索引和内容，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include RecordingEntry, libraryLimits, listRecordings, saveRecording, recordingBlob, deleteRecording, clearRecordings. The scope covers Saving recording indexes and content in a single IndexedDB transaction. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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
/**
 * 中文：打开版本 1 的录制数据库并创建索引/内容仓库；blocked/error 明确拒绝，失败后晚到 onsuccess 立即关闭数据库，versionchange 自动释放旧连接。
 * English: Open the version-one recording database/create index and content stores. Explicitly reject blocked/error states, close late success after failure and release old connections on versionchange.
 * 中文：结果：Promise<IDBDatabase>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<IDBDatabase> carrying the described computation/transport result; throwing branches do not provide success
 */
function open(): Promise<IDBDatabase> {
  return new Promise(/** 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：resolve：此处理器的调用值；reject：此处理器的调用值 | English: Inputs: resolve: the invocation value for this handler; reject: the invocation value for this handler | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ (resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('此浏览器不支持录制库，仍可下载录制文件'));
      return;
    }
    let settled = false;
    const request = indexedDB.open(databaseName, 1);
    /**
     * 中文：在数据库初建或升级事务内创建索引和二进制内容两个仓库，后续保存把两者放入同一事务。
     * English: Create index/binary-content stores within the initial/upgrade transaction so subsequent saves can update both atomically.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    request.onupgradeneeded = () => {
      request.result.createObjectStore('index', { keyPath: 'id' });
      request.result.createObjectStore('content');
    };
    /**
     * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    request.onerror = () => {
      settled = true;
      reject(new Error('浏览器无法打开录制库'));
    };
    /**
     * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    request.onblocked = () => {
      settled = true;
      reject(new Error('录制库正在升级，请关闭其他 Sakura 标签页后重试'));
    };
    /**
     * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中关闭所属连接或存储对象，兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Saving recording indexes and content in a single IndexedDB transaction, close the owned connection/storage object, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中关闭所属连接或存储对象；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, close the owned connection/storage object. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
/**
 * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中按指定 Schema 校验并解码；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Saving recording indexes and content in a single IndexedDB transaction, validate/decode with the specified schema. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：entry：缓存中当前处理的共享资源条目
 * English: Inputs: entry: shared resource-cache entry being processed
 * 中文：拒绝原因：录制索引损坏。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 录制索引损坏. These errors reach the direct caller or this function's catch handler
 */
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
/**
 * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中关闭所属连接或存储对象；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Saving recording indexes and content in a single IndexedDB transaction, close the owned connection/storage object. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：结果：Promise<RecordingEntry[]>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<RecordingEntry[]> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
 * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
 */
export async function listRecordings(): Promise<RecordingEntry[]> {
  const db = await open();
  try {
    return await new Promise(/**
     * 中文功能：在只读 IndexedDB 事务完成时验证录制索引，并按 createdAt 倒序返回；事务 abort 或条目校验失败拒绝。
     * English: Validate the recording index when the readonly IndexedDB transaction completes and return it in descending createdAt order; reject aborts or entry-validation failures.
     * 输入 / Inputs: resolve; reject.
     * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
     * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
     * 设计思路：等待 tx.oncomplete 后处理 request.result，避免将单个 request 成功当作事务完成；校验失败通过 Promise 拒绝保留错误。
     * Design: Process request.result after tx.oncomplete instead of treating individual request success as transaction completion; propagate validation failures by rejecting the Promise.
     */
    (resolve, reject) => {
      const tx = db.transaction('index', 'readonly'),
        request = tx.objectStore('index').getAll();
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      tx.onabort = () => reject(new Error('无法读取录制库'));
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中兑现当前异步等待，拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, fulfill the current asynchronous wait, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
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
/**
 * 中文：先校验索引与 Blob 大小/类型一致，再在同一读写事务内核对容量并同时添加索引和内容。重复 ID、配额或写入失败会回滚，finally 关闭数据库连接。
 * English: Validate that index metadata matches blob size/type, then check capacity and add index/content within one read-write transaction. Duplicate IDs, quota failures or writes abort atomically; finally close the database connection.
 * 中文：输入：entry：缓存中当前处理的共享资源条目；blob：签名所示 Blob 业务值
 * English: Inputs: entry: shared resource-cache entry being processed; blob: the Blob domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 * 中文：拒绝原因：录制内容与索引不一致。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 录制内容与索引不一致. These errors reach the direct caller or this function's catch handler
 * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
 * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
 */
export async function saveRecording(entry: RecordingEntry, blob: Blob): Promise<void> {
  checked(entry);
  if (blob.size !== entry.bytes || blob.type !== entry.mime) throw new Error('录制内容与索引不一致');
  const db = await open();
  try {
    await new Promise<void>(/** 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中读取存储目录条目；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Saving recording indexes and content in a single IndexedDB transaction, read stored index entries. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：resolve：此处理器的调用值；reject：此处理器的调用值 | English: Inputs: resolve: the invocation value for this handler; reject: the invocation value for this handler | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ (resolve, reject) => {
      // 元数据与 Blob 在同一读写事务内提交，容量检查失败同时回滚，避免出现只有索引或只有视频的半条记录。
      const tx = db.transaction(['index', 'content'], 'readwrite');
      let error = '保存失败，浏览器空间可能不足；仍可下载此次录制';
      const index = tx.objectStore('index');
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中登记集合或存储条目，取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, register collection/storage entries, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：输入：event：触发本处理器的事件及其数据
       * English: Inputs: event: triggering event and its data
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       * 中文：拒绝原因：此录制已经保存；录制库已满（32 条或 256 MiB），请先删除不需要的录制，或直接下载。这些错误交给直接调用者或本函数 catch 处理
       * English: Refusal reasons: 此录制已经保存; 录制库已满（32 条或 256 MiB），请先删除不需要的录制，或直接下载. These errors reach the direct caller or this function's catch handler
       */
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
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      tx.oncomplete = () => resolve();
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      tx.onabort = () => reject(new Error(error));
    });
  } finally {
    db.close();
  }
}
/**
 * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中关闭所属连接或存储对象；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Saving recording indexes and content in a single IndexedDB transaction, close the owned connection/storage object. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：entry：缓存中当前处理的共享资源条目
 * English: Inputs: entry: shared resource-cache entry being processed
 * 中文：结果：Promise<Blob>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<Blob> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
 * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
 */
export async function recordingBlob(entry: RecordingEntry): Promise<Blob> {
  checked(entry);
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('content', 'readonly'),
        request = tx.objectStore('content').get(entry.id);
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      tx.onabort = () => reject(new Error('无法读取录制内容'));
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待，兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
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
/**
 * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中关闭所属连接或存储对象；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Saving recording indexes and content in a single IndexedDB transaction, close the owned connection/storage object. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：id：目标资源标识
 * English: Inputs: id: target resource identifier
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 * 中文：拒绝原因：无效的录制标识。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 无效的录制标识. These errors reach the direct caller or this function's catch handler
 * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
 * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
 */
export async function deleteRecording(id: string): Promise<void> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的录制标识');
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['index', 'content'], 'readwrite');
      tx.objectStore('index').delete(id);
      tx.objectStore('content').delete(id);
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      tx.oncomplete = () => resolve();
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      tx.onabort = () => reject(new Error('无法删除录制'));
    });
  } finally {
    db.close();
  }
}
/**
 * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中关闭所属连接或存储对象；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Saving recording indexes and content in a single IndexedDB transaction, close the owned connection/storage object. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
 * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
 */
export async function clearRecordings(): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['index', 'content'], 'readwrite');
      tx.objectStore('index').clear();
      tx.objectStore('content').clear();
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      tx.oncomplete = () => resolve();
      /**
       * 中文：在在单一 IndexedDB 事务中保存录制索引和内容流程中拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Saving recording indexes and content in a single IndexedDB transaction, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      tx.onabort = () => reject(new Error('无法清空录制库'));
    });
  } finally {
    db.close();
  }
}
