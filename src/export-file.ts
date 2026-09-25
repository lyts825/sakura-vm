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
