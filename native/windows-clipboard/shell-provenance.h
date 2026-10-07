/**
 * 模块职责（中文）：以公开初始化/更新/Delete 真实结果追踪属性列表的指针代次、线程、容量及自有 Job。原 OS 操作与认领在一把锁内原子发生，Job 存储至少活到真实 Delete，不解析或重建不透明 Shell 属性。
 * Module responsibilities (English): Track attribute-list pointer generation/thread/capacity/owned Job through actual public initialize/update/Delete results. Original OS operations/claims occur atomically under one lock, Job storage lives through actual Delete and opaque Shell attributes are never parsed/rebuilt.
 */
/** Shell 进程属性列表的来源账本，按初始化代次和实际更新结果追踪 Job 列表，防止已删除或重用指针冒充有效来源。 */
#pragma once
#include <windows.h>
#include <algorithm>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <unordered_map>
#include <vector>
#include "descendant-cleanup.h"

// Only public attribute-list operations are observed. The OS's opaque list,
// including Shell's private attributes, is never inspected or reconstructed.
// 属性列表指针会被回收重用，账本需要初始化代次及真实更新/删除结果，不能只按地址放行。
class ShellAttributeLedger {
public:
  /** 中文：在独占锁内阻止重新初始化或修改已认领列表，并使原记录失效；未认领普通更新交给后续核验。 English: Under exclusive lock refuse reinitialization/mutation of claimed lists and invalidate the record; ordinary unclaimed updates proceed to later validation. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,bool reinitialize. */
  bool refuseMutation(LPPROC_THREAD_ATTRIBUTE_LIST list,bool reinitialize) {
    Lock guard(lock);const auto found=entries.find(list);if(found==entries.end())return false;
    if(!reinitialize && !found->second->claimed)return false;
    found->second->valid=false;return true;
  }
  struct Record {
    LPPROC_THREAD_ATTRIBUTE_LIST list=nullptr;
    uint64_t scope=0;
    DWORD thread=0,capacity=0;
    bool valid=true,deleted=false,claimed=false,committed=false;
    std::vector<DWORD_PTR> keys;
    // Stable address and exact duplicated Job remain live through OS Delete.
    HANDLE job=nullptr,child=nullptr;
    /** 中文：释放账本保存的精确子进程和 Job 副本；稳定 Job 地址和句柄至少保留到原 OS Delete 完成。 English: Release exact child/Job duplicates retained by the ledger; stable Job storage/handles live at least through original OS Delete. */
    ~Record(){if(child)CloseHandle(child);if(job)CloseHandle(job);}
  };
  using Pointer=std::shared_ptr<Record>;
private:
  SRWLOCK lock=SRWLOCK_INIT;
  std::unordered_map<LPPROC_THREAD_ATTRIBUTE_LIST,Pointer> entries;
  struct Lock {
    SRWLOCK* value;
    /** 中文：获取账本独占 SRW 锁，串行化原属性操作与来源登记/认领。 English: Acquire the exclusive ledger SRW lock to serialize original attribute operations with provenance registration/claiming. 参数声明 / Declared parameters: SRWLOCK& input. */
    explicit Lock(SRWLOCK& input):value(&input){AcquireSRWLockExclusive(value);}
    /** 中文：离开账本临界区，正常返回或异常展开都释放独占锁。 English: Leave the ledger critical section and release its exclusive lock on normal return or exception unwinding. */
    ~Lock(){ReleaseSRWLockExclusive(value);}
  };
  /** 中文：要求记录有效、未删除且当前指针映射仍指向同一共享记录，阻止地址回收后冒充旧代次。 English: Require valid/not-deleted records and the same shared record in the current pointer map to prevent recycled addresses impersonating old generations. 参数声明 / Declared parameters: const Pointer& record. */
  bool live(const Pointer& record) const {
    const auto found=entries.find(record->list);
    return record->valid && !record->deleted && found!=entries.end() && found->second==record;
  }
  /** 中文：仅登记可信同线程作用域中成功初始化的有界容量列表；已有地址隔离至真实 Delete，不能覆盖仍被 OS 引用的 Job 存储。 English: Register bounded-capacity lists only after trusted successful initialization in a scope; quarantine existing addresses until actual Delete instead of replacing storage still referenced by the OS. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD capacity,DWORD flags, uint64_t scope,DWORD thread,bool trusted,bool succeeded. */
  Pointer initializedLocked(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD capacity,DWORD flags,
      uint64_t scope,DWORD thread,bool trusted,bool succeeded) {
    const auto previous=entries.find(list);
    if(previous!=entries.end()){
      // Reinitialization cannot silently replace a still-live table, its Job,
      // or the storage referenced by Windows. Quarantine until actual Delete.
      previous->second->valid=false;return {};
    }
    if(!list || !scope || !trusted || !succeeded || flags || !capacity || capacity>64 || entries.size()>=64)return {};
    auto record=std::make_shared<Record>();record->list=list;record->scope=scope;
    record->thread=thread;record->capacity=capacity;record->keys.reserve(capacity);
    entries.emplace(list,record);return record;
  }
  /** 中文：核对作用域、线程、可信调用者与真实更新结果，记录唯一键；不支持的参数、失败、认领后更新或容量超限均使记录失效。 English: Verify scope/thread/trusted caller/actual update result and record unique keys; unsupported parameters, failures, post-claim updates or capacity overflow invalidate the record. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key, PVOID previous,PSIZE_T returned,uint64_t scope,DWORD thread,bool trusted,bool succeeded. */
  void updatedLocked(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key,
      PVOID previous,PSIZE_T returned,uint64_t scope,DWORD thread,bool trusted,bool succeeded) {
    const auto found=entries.find(list);if(found==entries.end())return;
    const auto& record=found->second;
    if(!record->valid || record->claimed || record->scope!=scope || record->thread!=thread ||
        !trusted || !succeeded || flags || previous || returned){record->valid=false;return;}
    if(std::find(record->keys.begin(),record->keys.end(),key)==record->keys.end()){
      if(record->keys.size()>=record->capacity){record->valid=false;return;}
      record->keys.push_back(key);
    }
  }
public:
  /** 中文：加锁登记已经观察到的公开初始化结果，返回记录供所属 Shell 作用域持有。 English: Lock/register an observed public initialization result and return its record for the owning Shell scope. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD capacity,DWORD flags, uint64_t scope,DWORD thread,bool trusted,bool succeeded. */
  Pointer initialized(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD capacity,DWORD flags,
      uint64_t scope,DWORD thread,bool trusted,bool succeeded) {
    Lock guard(lock);return initializedLocked(list,capacity,flags,scope,thread,trusted,succeeded);
  }
  /** 中文：加锁登记已经观察到的公开更新结果，异常来源不会获得可认领状态。 English: Lock/register an observed public update result without granting claimable state to invalid provenance. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key, PVOID previous,PSIZE_T returned,uint64_t scope,DWORD thread,bool trusted,bool succeeded. */
  void updated(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key,
      PVOID previous,PSIZE_T returned,uint64_t scope,DWORD thread,bool trusted,bool succeeded) {
    Lock guard(lock);updatedLocked(list,flags,key,previous,returned,scope,thread,trusted,succeeded);
  }
  /** 中文：持锁调用原初始化并立即登记结果，避免初始化成功与登记之间被认领；同地址活记录先拒绝并保留原 LastError 契约。 English: Hold the lock across original initialization and registration to prevent claims in between; refuse existing live addresses and preserve original LastError semantics. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD capacity,DWORD flags, uint64_t scope,DWORD thread,bool trusted,Pointer& observed,Call call. */
  template<class Call>BOOL initialize(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD capacity,DWORD flags,
      uint64_t scope,DWORD thread,bool trusted,Pointer& observed,Call call) {
    Lock guard(lock);const auto existing=entries.find(list);
    if(existing!=entries.end()){existing->second->valid=false;SetLastError(ERROR_NOT_SUPPORTED);return FALSE;}
    const BOOL result=call();const DWORD error=GetLastError();
    // No claim, update or reinitialization may interleave between the actual
    // Windows initialization and registration of that exact list pointer.
    try{observed=initializedLocked(list,capacity,flags,scope,thread,trusted,result!=FALSE);}catch(...){}
    SetLastError(error);return result;
  }
  /** 中文：持锁覆盖原更新及来源记录，避免认领与真实属性变更交错；已认领列表绝不调用原修改函数。 English: Hold the lock across original update/provenance recording to prevent interleaved claims; never call original mutation for a claimed list. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key, PVOID previous,PSIZE_T returned,uint64_t scope,DWORD thread,bool trusted,Call call. */
  template<class Call>BOOL update(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key,
      PVOID previous,PSIZE_T returned,uint64_t scope,DWORD thread,bool trusted,Call call) {
    Lock guard(lock);const auto found=entries.find(list);
    if(found!=entries.end() && found->second->claimed){found->second->valid=false;SetLastError(ERROR_NOT_SUPPORTED);return FALSE;}
    // Keep the original synchronous public Update and its provenance decision
    // under one lock. A foreign/unclaimed update cannot race claim or invoke.
    const BOOL result=call();const DWORD error=GetLastError();
    try{updatedLocked(list,flags,key,previous,returned,scope,thread,trusted,result!=FALSE);}
    catch(...){if(found!=entries.end())found->second->valid=false;}
    SetLastError(error);return result;
  }
  // Called only after the original Delete has consumed the original table.
  /** 中文：原 Delete 在锁内先执行，随后标记删除并移除映射；跨线程或错误作用域使记录失效，但仍释放 OS 列表。 English: Execute original Delete under lock before marking deleted/removing the map; wrong thread/scope invalidates provenance while still freeing the OS list. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,uint64_t scope,DWORD thread,bool trusted,decltype(&DeleteProcThreadAttributeList) original. */
  void deleted(LPPROC_THREAD_ATTRIBUTE_LIST list,uint64_t scope,DWORD thread,bool trusted,decltype(&DeleteProcThreadAttributeList) original) {
    Lock guard(lock);const auto found=entries.find(list);
    if(found==entries.end()){original(list);return;}
    const auto record=found->second;
    if(record->scope!=scope || record->thread!=thread || !trusted)record->valid=false;
    original(list);const DWORD error=GetLastError();
    record->deleted=true;entries.erase(found);
    SetLastError(error);
  }
  /** 中文：只认领同线程、同作用域且有空槽、无原 JOB_LIST 的活记录；每列表仅能创建一个受控子进程。 English: Claim only a live same-thread/scope record with free capacity and no existing JOB_LIST; each list may create only one controlled child. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,uint64_t scope,DWORD thread. */
  Pointer claim(LPPROC_THREAD_ATTRIBUTE_LIST list,uint64_t scope,DWORD thread) {
    Lock guard(lock);const auto found=entries.find(list);if(found==entries.end())return {};
    const auto& record=found->second;
    if(!live(record) || record->scope!=scope || record->thread!=thread || record->claimed ||
        record->keys.size()>=record->capacity ||
        std::find(record->keys.begin(),record->keys.end(),PROC_THREAD_ATTRIBUTE_JOB_LIST)!=record->keys.end())return {};
    record->claimed=true;return record;
  }
  /** 中文：复制精确 Job 到稳定账本字段，再仅追加未占用 JOB_LIST 键，不重建 Shell 私有属性；失败使记录失效且保留句柄直到清理。 English: Duplicate the exact Job into stable ledger storage and append only an unused JOB_LIST key without reconstructing Shell private attributes; failure invalidates the record while retaining handles for cleanup. 参数声明 / Declared parameters: const Pointer& record,HANDLE job,decltype(&UpdateProcThreadAttribute) original. */
  bool append(const Pointer& record,HANDLE job,decltype(&UpdateProcThreadAttribute) original) {
    Lock guard(lock);
    if(!record || !live(record) || !record->claimed || record->job || !job || !original){SetLastError(ERROR_NOT_SUPPORTED);return false;}
    if(!DuplicateHandle(GetCurrentProcess(),job,GetCurrentProcess(),&record->job,0,FALSE,DUPLICATE_SAME_ACCESS))return false;
    // The original table has a proved unused capacity slot and no JOB_LIST.
    // All existing entries and their original value pointers stay unchanged.
    if(!original(record->list,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,&record->job,sizeof(record->job),nullptr,nullptr)){
      record->valid=false;return false;
    }
    record->keys.push_back(PROC_THREAD_ATTRIBUTE_JOB_LIST);return true;
  }
  /** 中文：持锁同步执行原 CreateProcess 并固定成功返回的精确子句柄；不在锁内等待服务代理，避免跨线程 Delete 与调用交错。 English: Hold the lock for synchronous original CreateProcess and pin its exact successful child handle; never wait for the service broker under this lock and prevent interleaved cross-thread Delete. 参数声明 / Declared parameters: const Pointer& record,PROCESS_INFORMATION& child,Call call. */
  template<class Call>BOOL invoke(const Pointer& record,PROCESS_INFORMATION& child,Call call) {
    Lock guard(lock);
    if(!record || !live(record) || !record->job || record->child){SetLastError(ERROR_NOT_SUPPORTED);return FALSE;}
    // Serialize only the original synchronous OS creation with Delete/updates.
    // Never hold this lock while waiting for broker/service attachment.
    const BOOL result=call();const DWORD error=GetLastError();
    if(result && !DuplicateHandle(GetCurrentProcess(),child.hProcess,GetCurrentProcess(),&record->child,0,FALSE,DUPLICATE_SAME_ACCESS))record->valid=false;
    SetLastError(error);return result;
  }
  /** 中文：核对活记录已认领且含精确子句柄，证明原创建确实在该记录内完成。 English: Check a live claimed record with an exact child handle, proving original creation completed through this record. 参数声明 / Declared parameters: const Pointer& record. */
  bool created(const Pointer& record) {
    Lock guard(lock);return record && live(record) && record->child;
  }
  /** 中文：仅将仍存活且具有 Job/子句柄的记录标记提交，供 Shell 返回成功时验收。 English: Mark committed only a still-live record with Job/child handles for validation of successful Shell return. 参数声明 / Declared parameters: const Pointer& record. */
  bool commit(const Pointer& record) {
    Lock guard(lock);if(!record || !live(record) || !record->child || !record->job)return false;
    record->committed=true;return true;
  }
  /** 中文：要求所有作用域记录有效且经过原 Delete，认领记录已提交并持有 Job/子句柄，且恰好创建一个子进程。 English: Require all scope records valid and actually deleted, claimed records committed with Job/child handles and exactly one created child. 参数声明 / Declared parameters: const std::vector<Pointer>& records. */
  bool completed(const std::vector<Pointer>& records) {
    Lock guard(lock);unsigned created=0;
    for(const auto& record:records){
      if(!record->valid || !record->deleted)return false;
      if(record->claimed){if(!record->committed || !record->child || !record->job)return false;++created;}
    }
    return created==1;
  }
  /** 中文：使本作用域记录失效，先终止自有 Job 再在锁外用精确子句柄补救清理，不按 PID 扩大终止范围。 English: Invalidate this scope's records, terminate owned Jobs and perform exact-child fallback cleanup outside the lock without expanding termination by PID. 参数声明 / Declared parameters: const std::vector<Pointer>& records. */
  void cancel(const std::vector<Pointer>& records) {
    std::vector<HANDLE> children;
    {
      Lock guard(lock);
      for(const auto& record:records){
        record->valid=false;
        // A missing/cross-thread Delete keeps the exact value storage and Job
        // in entries, but cannot leave any child alive or allow table reuse.
        if(record->job)TerminateJobObject(record->job,1);
        if(record->child)children.push_back(record->child);
      }
    }
    for(HANDLE child:children)sakuraTerminateOwnedChild(nullptr,child);
  }
};
