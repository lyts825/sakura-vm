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
class ShellAttributeLedger {
public:
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
    ~Record(){if(child)CloseHandle(child);if(job)CloseHandle(job);}
  };
  using Pointer=std::shared_ptr<Record>;
private:
  SRWLOCK lock=SRWLOCK_INIT;
  std::unordered_map<LPPROC_THREAD_ATTRIBUTE_LIST,Pointer> entries;
  struct Lock {
    SRWLOCK* value;
    explicit Lock(SRWLOCK& input):value(&input){AcquireSRWLockExclusive(value);}
    ~Lock(){ReleaseSRWLockExclusive(value);}
  };
  bool live(const Pointer& record) const {
    const auto found=entries.find(record->list);
    return record->valid && !record->deleted && found!=entries.end() && found->second==record;
  }
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
  Pointer initialized(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD capacity,DWORD flags,
      uint64_t scope,DWORD thread,bool trusted,bool succeeded) {
    Lock guard(lock);return initializedLocked(list,capacity,flags,scope,thread,trusted,succeeded);
  }
  void updated(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key,
      PVOID previous,PSIZE_T returned,uint64_t scope,DWORD thread,bool trusted,bool succeeded) {
    Lock guard(lock);updatedLocked(list,flags,key,previous,returned,scope,thread,trusted,succeeded);
  }
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
  void deleted(LPPROC_THREAD_ATTRIBUTE_LIST list,uint64_t scope,DWORD thread,bool trusted,decltype(&DeleteProcThreadAttributeList) original) {
    Lock guard(lock);const auto found=entries.find(list);
    if(found==entries.end()){original(list);return;}
    const auto record=found->second;
    if(record->scope!=scope || record->thread!=thread || !trusted)record->valid=false;
    original(list);const DWORD error=GetLastError();
    record->deleted=true;entries.erase(found);
    SetLastError(error);
  }
  Pointer claim(LPPROC_THREAD_ATTRIBUTE_LIST list,uint64_t scope,DWORD thread) {
    Lock guard(lock);const auto found=entries.find(list);if(found==entries.end())return {};
    const auto& record=found->second;
    if(!live(record) || record->scope!=scope || record->thread!=thread || record->claimed ||
        record->keys.size()>=record->capacity ||
        std::find(record->keys.begin(),record->keys.end(),PROC_THREAD_ATTRIBUTE_JOB_LIST)!=record->keys.end())return {};
    record->claimed=true;return record;
  }
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
  template<class Call>BOOL invoke(const Pointer& record,PROCESS_INFORMATION& child,Call call) {
    Lock guard(lock);
    if(!record || !live(record) || !record->job || record->child){SetLastError(ERROR_NOT_SUPPORTED);return FALSE;}
    // Serialize only the original synchronous OS creation with Delete/updates.
    // Never hold this lock while waiting for broker/service attachment.
    const BOOL result=call();const DWORD error=GetLastError();
    if(result && !DuplicateHandle(GetCurrentProcess(),child.hProcess,GetCurrentProcess(),&record->child,0,FALSE,DUPLICATE_SAME_ACCESS))record->valid=false;
    SetLastError(error);return result;
  }
  bool created(const Pointer& record) {
    Lock guard(lock);return record && live(record) && record->child;
  }
  bool commit(const Pointer& record) {
    Lock guard(lock);if(!record || !live(record) || !record->child || !record->job)return false;
    record->committed=true;return true;
  }
  bool completed(const std::vector<Pointer>& records) {
    Lock guard(lock);unsigned created=0;
    for(const auto& record:records){
      if(!record->valid || !record->deleted)return false;
      if(record->claimed){if(!record->committed || !record->child || !record->job)return false;++created;}
    }
    return created==1;
  }
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
