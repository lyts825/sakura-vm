"""Linux exec-only ownership handoff. No shell, daemon, PID-based reaping or extra process.

The caller owns this process handle and budgets it before spawning. Preserve the
same PID through exec and have the kernel kill it when that exact parent dies.
This is a lifecycle mechanism for trusted programs, not a security sandbox.
"""
import ctypes
import os
import signal
import stat
import sys


def main():
    if sys.platform != "linux" or len(sys.argv) < 3:
        raise RuntimeError("parent-exec requires Linux, a parent PID and an absolute program")
    parent = int(sys.argv[1])
    program = sys.argv[2]
    if parent <= 1 or not os.path.isabs(program) or os.getppid() != parent:
        raise RuntimeError("original parent is no longer alive")
    # Privilege-changing exec clears PDEATHSIG. Refuse those binaries, including
    # file capabilities, instead of silently dropping lifecycle ownership.
    mode = os.stat(program).st_mode
    if mode & (stat.S_ISUID | stat.S_ISGID):
        raise RuntimeError("privileged executables are not supported")
    if "security.capability" in os.listxattr(program):
        raise RuntimeError("file-capability executables are not supported")
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:  # PR_SET_PDEATHSIG
        raise OSError(ctypes.get_errno(), "PR_SET_PDEATHSIG failed")
    # If the parent died before prctl, Linux has already reparented us. If it dies
    # after this check, the kernel sends SIGKILL; there is no check/exec gap.
    if os.getppid() != parent:
        raise RuntimeError("original parent exited before ownership handoff")
    os.execv(program, sys.argv[2:])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("network parent-exec: " + str(error), file=sys.stderr)
        sys.exit(125)
