export function clipboardFiles(data: Pick<DataTransfer, 'files'>): File[] {
  return Array.from(data.files).map((file) => {
    if (file.name && file.name !== 'image.png' && file.name !== 'image.jpeg') return file;
    const extension =
      (
        { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<
          string,
          string
        >
      )[file.type] || 'bin';
    return new File(
      [file],
      'clipboard-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.' + extension,
      { type: file.type },
    );
  });
}
