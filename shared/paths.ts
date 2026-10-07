/**
 * 模块职责（中文）：校验资源标识和客户机绝对路径，拒绝不符合接口约束的输入。
 * Module responsibility (English): Validating resource UUIDs and guest absolute-path shapes.
 * 详细范围（中文）：公开入口包括 checkedId, guestPath；职责覆盖校验资源 UUID 和客户机绝对路径形状，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include checkedId, guestPath. The scope covers Validating resource UUIDs and guest absolute-path shapes. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { AppError } from './errors.ts';

/**
 * 中文：验证实例标识为小写十六进制 UUID，失败抛出 HTTP 400 输入错误，通过后返回原值。
 * English: Validate a VM ID as a lowercase hexadecimal UUID; throw an HTTP-four-hundred input error on failure and return the original value on success.
 * 中文：输入：id：目标资源标识
 * English: Inputs: id: target resource identifier
 * 中文：拒绝原因：无效的实例标识。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 无效的实例标识. These errors reach the direct caller or this function's catch handler
 */
export function checkedId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    throw new AppError('无效的实例标识', 400);
  return id;
}
// 这里只检查接口路径形状，不做文件系统解析或权限判断；路径归属和访问权限由实际执行层校验。
/**
 * 中文：只接受长度不超过 4096、以斜杠开头且不含控制字符的 Linux 绝对路径；返回原字符串，路径访问权限由服务层另行校验。
 * English: Accept Linux absolute paths beginning with slash, no longer than 4096 and containing no control characters. Return the original string; the service layer checks access authority separately.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：结果：string，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: string carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：需要有效的 Linux 绝对路径。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 需要有效的 Linux 绝对路径. These errors reach the direct caller or this function's catch handler
 */
export function guestPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\x00-\x1f]/.test(value))
    throw new AppError('需要有效的 Linux 绝对路径');
  return value;
}
