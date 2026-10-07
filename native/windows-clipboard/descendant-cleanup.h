/** 后代创建失败时清理已持有的精确进程句柄，兼顾尚未进入 Job 的子进程，避免按猜测 PID 结束进程。 */
#pragma once
#include <windows.h>

// Call only with an already-owned exact process handle, never a guessed PID.
// A successful creation can still have failed Job validation; killing the Job
// alone does not prove that this particular suspended process was reclaimed.
inline bool sakuraTerminateOwnedChild(HANDLE job,HANDLE child) {
  if(job)TerminateJobObject(job,1);
  if(!child)return true;
  if(WaitForSingleObject(child,0)!=WAIT_OBJECT_0)TerminateProcess(child,1);
  return WaitForSingleObject(child,30000)==WAIT_OBJECT_0;
}
