/**
 * 模块职责（中文）：通过临时对象 URL 导出 Blob 或文本，完成下载后释放浏览器资源。
 * Module responsibility (English): Downloading blobs or JSON and releasing temporary object URLs.
 * 详细范围（中文）：公开入口包括 saveBlob, saveText；职责覆盖下载 Blob 或 JSON 并释放临时对象 URL，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include saveBlob, saveText. The scope covers Downloading blobs or JSON and releasing temporary object URLs. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
/**
 * 中文：为 Blob 创建对象 URL，触发指定文件名的浏览器下载后移除 anchor，并延迟释放 URL 让浏览器有机会读取。
 * English: Create a Blob object URL, trigger a browser download with the requested filename, remove the anchor and delay URL revocation so the browser can read it.
 * 中文：输入：name：目标名称或文件名；blob：签名所示 Blob 业务值
 * English: Inputs: name: target name/filename; blob: the Blob domain value in the signature
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 中文：把文本按指定 MIME 类型包装为 Blob 后调用统一下载入口；文件名和编码由调用者提供。
 * English: Wrap text in a Blob with the supplied MIME type and use the shared download entry point; callers supply filename/content.
 * 中文：输入：name：目标名称或文件名；value：待校验、转换或保存的输入值
 * English: Inputs: name: target name/filename; value: input value to validate/transform/save
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function saveText(name: string, value: unknown) {
  saveBlob(name, new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
}
