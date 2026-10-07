/**
 * 模块职责：按 POSIX shell 的单引号规则引用参数，供客户机固定命令安全传递字符串。
 */
/** POSIX shell argument quoting; has no filesystem or service dependencies. */
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
