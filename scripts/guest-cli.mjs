/** 将 CLI 参数转为结构化 guest 执行请求，保留字面参数与项目作用域，避免把参数拼成 root shell 文本。
 * Convert literal CLI arguments to structured guest execution requests with explicit project scope, preserving shell argument boundaries. */
const projectId = /^(default|[a-f0-9]{16})$/;
const usage = 'exec <name> [--project <id> | --instance] [--timeout <seconds>] -- <command> [args...]';
/** 严格解析项目/实例互斥作用域、超时和 -- 后字面命令参数，拒绝重复选项及非法范围。
 * Strictly parse mutually exclusive project/instance scope, timeout and literal argv after --, rejecting duplicate options/invalid bounds. */
export function guestArguments(action, args) {
  let project, instance = false, timeoutSeconds, index = 0;
  while (index < args.length) {
    const option = args[index];
    if (option === '--') { index++; break; }
    if (!option.startsWith('--')) break;
    if (option === '--project' && !project) {
      project = args[++index];
      if (!projectId.test(project || '')) throw new Error('Use a valid --project ID');
    } else if (option === '--instance' && !instance && action === 'exec') instance = true;
    else if (option === '--timeout' && timeoutSeconds === undefined && action === 'exec') {
      timeoutSeconds = Number(args[++index]);
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600)
        throw new Error('--timeout must be between 1 and 3600 seconds');
    } else throw new Error('Unknown or repeated option: ' + option);
    index++;
  }
  if (instance && project) throw new Error('Choose --project or --instance');
  const argv = args.slice(index);
  if (action === 'shell' && argv.length) throw new Error('Usage: shell <name> [--project <id>]');
  if (action === 'exec' && !argv.length) throw new Error('Usage: ' + usage);
  return { project, instance, timeoutSeconds, argv };
}

/** 将解析结果转换为 guest 执行请求，默认沿活动项目，逐参数引用保留字面值。
 * Convert parsed arguments to guest execution requests, defaulting to the active project and quoting each literal argument. */
export function guestExecution(vmId, options) {
  /** 以 POSIX 单引号及内嵌引号转义封装一个字面参数，防止空格/元字符变成 shell 语法。
   * Wrap one literal argument with POSIX single-quote escaping so spaces/metacharacters remain data. */
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  return { path: `/vms/${encodeURIComponent(vmId)}/exec` +
    (options.project ? `?project=${encodeURIComponent(options.project)}` : ''),
  body: { command: options.argv.map(quote).join(' '),
    ...(options.instance ? { scope: 'instance' } : {}),
    ...(options.timeoutSeconds !== undefined ? { timeoutSeconds: options.timeoutSeconds } : {}) } };
}
