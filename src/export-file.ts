/**
 * 模块职责：通过临时对象 URL 导出 Blob 或文本，完成下载后释放浏览器资源。
 */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveText(name: string, value: unknown) {
  saveBlob(name, new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
}
