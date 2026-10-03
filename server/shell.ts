/** POSIX shell argument quoting; has no filesystem or service dependencies. */
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
