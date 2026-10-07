/**
 * 模块职责（中文）：封装精确自有后代的终止与等待，Job 终止不能覆盖目标时使用已经持有的进程句柄补救，避免 PID 复用扩大清理范围。
 * Module responsibilities (English): Encapsulate termination/waiting for exact owned descendants, falling back to a retained process handle when Job termination does not cover the target without expanding cleanup through reused PIDs.
 */
/** 后代创建失败时清理已持有的精确进程句柄，兼顾尚未进入 Job 的子进程，避免按猜测 PID 结束进程。 */
#pragma once
#include <windows.h>

// Call only with an already-owned exact process handle, never a guessed PID.
// A successful creation can still have failed Job validation; killing the Job
// alone does not prove that this particular suspended process was reclaimed.
/** 中文：只对本层持有的精确 Job/子进程句柄执行终止与等待，不凭 PID 列表扩散清理；无法确认退出时保留失败语义。 English: Terminate/wait only through this layer's exact owned Job/child handles rather than expanding cleanup by PID lists, retaining failure when exit cannot be confirmed. 参数声明 / Declared parameters: HANDLE job,HANDLE child. */
inline bool sakuraTerminateOwnedChild(HANDLE job,HANDLE child) {
  if(job)TerminateJobObject(job,1);
  if(!child)return true;
  if(WaitForSingleObject(child,0)!=WAIT_OBJECT_0)TerminateProcess(child,1);
  return WaitForSingleObject(child,30000)==WAIT_OBJECT_0;
}
