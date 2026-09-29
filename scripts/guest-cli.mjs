const projectId = /^(default|[a-f0-9]{16})$/;
const usage = 'exec <name> [--project <id> | --instance] [--timeout <seconds>] -- <command> [args...]';
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

export function guestExecution(vmId, options) {
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  return { path: `/vms/${encodeURIComponent(vmId)}/exec` +
    (options.project ? `?project=${encodeURIComponent(options.project)}` : ''),
  body: { command: options.argv.map(quote).join(' '),
    ...(options.instance ? { scope: 'instance' } : {}),
    ...(options.timeoutSeconds !== undefined ? { timeoutSeconds: options.timeoutSeconds } : {}) } };
}
