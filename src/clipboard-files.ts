/**
 * 模块职责（中文）：从浏览器剪贴板项目中提取文件，为文件粘贴上传入口统一处理文件列表。
 * Module responsibility (English): Extracting clipboard files and assigning usable names to unnamed images.
 * 详细范围（中文）：公开入口包括 clipboardFiles；职责覆盖从剪贴板提取文件并为匿名图像提供可保存名称，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include clipboardFiles. The scope covers Extracting clipboard files and assigning usable names to unnamed images. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
/**
 * 中文：把剪贴板 FileList 转为可上传数组；保留已有有效文件名，仅为默认图像名或空名按 MIME 类型分配带时间戳和随机后缀的名称，文件字节保持原样。
 * English: Convert clipboard FileList entries to an uploadable array. Preserve usable names; replace empty/default image names with MIME-derived names containing a timestamp and random suffix, retaining the original bytes.
 * 中文：输入：data：签名所示 Pick<DataTransfer, 'files'> 业务值
 * English: Inputs: data: the Pick<DataTransfer, 'files'> domain value in the signature
 * 中文：结果：File[]，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: File[] carrying the described computation/transport result; throwing branches do not provide success
 */
export function clipboardFiles(data: Pick<DataTransfer, 'files'>): File[] {
  return Array.from(data.files).map(/**
   * 中文功能：保留已有明确文件名；匿名或默认命名的剪贴板图片根据 MIME 扩展名、时间和随机 ID 创建新 File，保留原类型与内容。
   * English: Keep explicit filenames; rebuild unnamed/default clipboard images as Files named from MIME extension/time/random ID, preserving original type/content.
   * 输入 / Inputs: file.
   * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
   * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
   */
  (file) => {
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
