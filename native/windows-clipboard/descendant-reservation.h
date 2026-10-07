/**
 * 模块职责（中文）：在父身份和构建范围中发布有限槽位的创建预约及精确 Job 名。预约先于创建可见，提交时转移 Job 所有权，清理只撤销自己的槽位并保留并发互斥。
 * Module responsibilities (English): Publish bounded creation-reservation slots/exact Job names scoped to parent identity/build. Reservations precede creation, transfer Job ownership on commit and clean only their own slots under concurrency locks.
 */
/** 创建前的命名 Job 预留表，绑定父 PID、创建时间和构建摘要，保护子进程出现到服务接管之间的窗口。 */
#pragma once
#include "protocol.h"
#include <sddl.h>
#include <tlhelp32.h>
#include <ole2.h>
#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

// The Job reservation exists before CreateProcess exposes a suspended child.
// Its exact membership protects the interval before the broker reaches Node;
// a PID, image name, missing module or timing delay is not that reservation.
constexpr uint32_t SakuraCreationMagic=0x53435253;
constexpr uint32_t SakuraCreationVersion=1;
constexpr size_t SakuraCreationCapacity=64;
struct SakuraCreationToken { uint64_t low,high; };
struct alignas(8) SakuraCreationRegistry {
  uint32_t magic,version,parentPid,reserved;
  uint64_t parentCreated;
  char build[65],padding[7];
  SakuraCreationToken jobs[SakuraCreationCapacity];
};
static_assert(sizeof(SakuraCreationRegistry)==1120,"Creation reservation ABI");
struct CreationHandle {
  HANDLE value;
  /** 中文：保存创建预约使用的自有句柄，禁止复制来保护 Job 和映射生命周期。 English: Retain an owned creation-reservation handle with copying prohibited to protect Job/mapping lifetimes. 参数声明 / Declared parameters: HANDLE input=nullptr. */
  explicit CreationHandle(HANDLE input=nullptr):value(input){}
  /** 中文：关闭创建预约仍持有的有效句柄，已显式转移的空值跳过。 English: Close a valid handle still owned by the creation reservation, skipping null after explicit transfer. */
  ~CreationHandle(){if(value && value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
  /** 中文：删除此类型的复制构造，避免裸句柄或自有缓冲区被多个对象重复释放；传入对象不能通过此声明复制。 English: Delete this type's copy constructor to prevent multiple objects releasing the same raw handle/owned buffer; the supplied object cannot be copied through this declaration. 参数声明 / Declared parameters: const CreationHandle&. */
  CreationHandle(const CreationHandle&)=delete;
};
struct CreationView {
  SakuraCreationRegistry* value=nullptr;
  /** 中文：解除预留表映射视图，句柄由所属 RAII 对象独立释放。 English: Unmap the reservation view; its owning RAII object closes the handle separately. */
  ~CreationView(){if(value)UnmapViewOfFile(value);}
};
struct CreationLock {
  HANDLE value;
  /** 中文：有界等待预留 writer 互斥量，允许 abandoned 后由后续完整身份校验决定使用，超时拒绝。 English: Boundedly wait for the reservation writer mutex, allowing abandoned acquisition only with subsequent full identity checks and rejecting timeout. 参数声明 / Declared parameters: HANDLE mutex. */
  explicit CreationLock(HANDLE mutex):value(mutex) {
    const DWORD result=WaitForSingleObject(value,15000);
    if(result!=WAIT_OBJECT_0 && result!=WAIT_ABANDONED)throw std::runtime_error("creation reservation writer unavailable");
  }
  /** 中文：释放构造时取得的预留 writer 互斥量。 English: Release the reservation writer mutex acquired during construction. */
  ~CreationLock(){ReleaseMutex(value);}
};
/** 中文：由 owner、父 PID 和创建时间生成预留表名字，使重启父进程不能继承旧预留。 English: Build the reservation-table name from owner/parent PID/creation time so a restarted parent cannot inherit old reservations. 参数声明 / Declared parameters: const std::wstring& owner,DWORD pid,uint64_t created. */
inline std::wstring descendantCreationName(const std::wstring& owner,DWORD pid,uint64_t created) {
  return L"Local\\SakuraClipboard.Creation."+owner+L"."+std::to_wstring(pid)+L"."+std::to_wstring(created);
}
/** 中文：把 128 位预留 token 规范成固定宽十六进制 Job 名，精确连接预留表与内核 Job。 English: Encode the one-hundred-twenty-eight-bit reservation token into a fixed-width hexadecimal Job name linking the table to the exact kernel Job. 参数声明 / Declared parameters: const std::wstring& name,const SakuraCreationToken& token. */
inline std::wstring descendantCreationJob(const std::wstring& name,const SakuraCreationToken& token) {
  constexpr wchar_t digits[]=L"0123456789abcdef";
  std::wstring result=name+L".job.";
  for(const uint64_t part:{token.low,token.high})for(int shift=60;shift>=0;shift-=4)result+=digits[(part>>shift)&15];
  return result;
}
/** 中文：同时检查预留 magic/version/reserved、父 PID/创建时间与构建摘要，不仅按映射名相信内容。 English: Check reservation magic/version/reserved/parent PID-creation/build rather than trusting contents from the mapping name alone. 参数声明 / Declared parameters: const SakuraCreationRegistry& value,DWORD pid,uint64_t created. */
inline bool descendantCreationValid(const SakuraCreationRegistry& value,DWORD pid,uint64_t created) {
  return value.magic==SakuraCreationMagic && value.version==SakuraCreationVersion && !value.reserved &&
    value.parentPid==pid && value.parentCreated==created && std::memcmp(value.build,SAKURA_CLIPBOARD_BUILD,65)==0;
}
// 预留存在于真实创建之前；关闭 Job 的兜底语义只在服务成功接管后解除。
class DescendantReservation {
  CreationHandle section,writer,job;
  CreationView view;
  size_t slot=SakuraCreationCapacity;
public:
  /** 中文：在 CreateProcess 前创建唯一命名 kill-on-close Job和用户/System ACL预留表，持 writer 锁填至多 64 个槽；任何身份或容量不确定都拒绝，封住子出现到服务接管之间的空窗。 English: Before CreateProcess create a unique named kill-on-close Job/user-System-ACL table and register under writer lock within sixty-four slots. Reject uncertain identity/capacity, protecting the gap from child appearance to service takeover. 参数声明 / Declared parameters: const std::wstring& owner. */
  explicit DescendantReservation(const std::wstring& owner) {
    const DWORD pid=GetCurrentProcessId();const auto created=processCreation(GetCurrentProcess());
    const auto name=descendantCreationName(owner,pid,created);
    CreationHandle token;DWORD size=0;
    if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.value))throw std::runtime_error("creation reservation user unavailable");
    GetTokenInformation(token.value,TokenUser,nullptr,0,&size);std::vector<unsigned char> bytes(size);
    if(!size || !GetTokenInformation(token.value,TokenUser,bytes.data(),size,&size))throw std::runtime_error("creation reservation user unavailable");
    wchar_t* sid=nullptr;
    if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid,&sid))throw std::runtime_error("creation reservation ACL unavailable");
    const std::wstring aclText=L"D:P(A;;GA;;;"+std::wstring(sid)+L")(A;;GA;;;SY)";LocalFree(sid);
    PSECURITY_DESCRIPTOR security=nullptr;
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(aclText.c_str(),SDDL_REVISION_1,&security,nullptr))throw std::runtime_error("creation reservation ACL unavailable");
    SECURITY_ATTRIBUTES acl{sizeof(acl),security,FALSE};
    writer.value=CreateMutexW(&acl,FALSE,(name+L".writer").c_str());
    section.value=CreateFileMappingW(INVALID_HANDLE_VALUE,&acl,PAGE_READWRITE,0,sizeof(SakuraCreationRegistry),name.c_str());
    GUID guid{};
    if(SUCCEEDED(CoCreateGuid(&guid))){
      SakuraCreationToken identity{};std::memcpy(&identity,&guid,sizeof(identity));
      job.value=CreateJobObjectW(&acl,descendantCreationJob(name,identity).c_str());
      const DWORD jobError=GetLastError();LocalFree(security);security=nullptr;
      if(!writer.value || !section.value || !job.value || jobError==ERROR_ALREADY_EXISTS)throw std::runtime_error("creation reservation unavailable");
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if(!SetInformationJobObject(job.value,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))throw std::runtime_error("creation reservation Job unavailable");
      view.value=static_cast<SakuraCreationRegistry*>(MapViewOfFile(section.value,FILE_MAP_ALL_ACCESS,0,0,sizeof(SakuraCreationRegistry)));
      if(!view.value)throw std::runtime_error("creation reservation view unavailable");
      CreationLock lock(writer.value);
      const auto raw=reinterpret_cast<const unsigned char*>(view.value);
      if(std::all_of(raw,raw+sizeof(SakuraCreationRegistry),[](unsigned char byte){return !byte;})){
        SakuraCreationRegistry registry{};registry.magic=SakuraCreationMagic;registry.version=SakuraCreationVersion;
        registry.parentPid=pid;registry.parentCreated=created;std::memcpy(registry.build,SAKURA_CLIPBOARD_BUILD,65);*view.value=registry;
      }
      if(!descendantCreationValid(*view.value,pid,created))throw std::runtime_error("creation reservation identity differs");
      for(size_t index=0;index<SakuraCreationCapacity;++index)if(!view.value->jobs[index].low && !view.value->jobs[index].high){slot=index;break;}
      if(slot==SakuraCreationCapacity)throw std::runtime_error("creation reservation capacity exceeded");
      view.value->jobs[slot]=identity;MemoryBarrier();
    }else{LocalFree(security);throw std::runtime_error("creation reservation identity unavailable");}
  }
  /** 中文：把精确 Job 句柄移交创建流程并置空本成员，析构不重复关闭已移交句柄。 English: Transfer the exact Job handle to creation and clear this member so destruction cannot close the transferred handle twice. */
  HANDLE releaseJob(){const HANDLE result=job.value;job.value=nullptr;return result;}
  /** 中文：尽力在 writer 锁内清空本实例预留槽，保留 RAII 资源清理；失败不通过析构抛出异常。 English: Best-effort clear this instance's slot under writer lock, retaining RAII cleanup without throwing from destruction. */
  ~DescendantReservation(){
    if(view.value && slot<SakuraCreationCapacity)try{CreationLock lock(writer.value);view.value->jobs[slot]={};MemoryBarrier();}catch(...){}
  }
  /** 中文：删除此类型的复制构造，避免裸句柄或自有缓冲区被多个对象重复释放；传入对象不能通过此声明复制。 English: Delete this type's copy constructor to prevent multiple objects releasing the same raw handle/owned buffer; the supplied object cannot be copied through this declaration. 参数声明 / Declared parameters: const DescendantReservation&. */
  DescendantReservation(const DescendantReservation&)=delete;
};
// Read-only OS identity and exact named Job membership. Called before ordinary
// apply creates a policy mapping or starts any remote loader/configure thread.
/** 中文：只读核对目标/原父创建时间及预留表，并验证当前目标确属表中精确命名 Job；普通 apply 在创建未提交期间必须拒绝，不能用同名映像或缺 DLL 代替成员证据。 English: Read-only verify target/original parent creation/table and exact named-Job membership. Ordinary apply must refuse pending creation; image names/missing DLLs cannot replace membership evidence. 参数声明 / Declared parameters: const std::wstring& owner,DWORD pid,uint64_t created. */
inline bool descendantCreationPending(const std::wstring& owner,DWORD pid,uint64_t created) {
  CreationHandle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid));
  if(!process.value || processCreation(process.value)!=created)return false;
  CreationHandle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0));
  if(snapshot.value==INVALID_HANDLE_VALUE)throw std::runtime_error("creation reservation ancestry unavailable");
  DWORD parentPid=0;PROCESSENTRY32W entry{};entry.dwSize=sizeof(entry);
  if(Process32FirstW(snapshot.value,&entry))do{if(entry.th32ProcessID==pid){parentPid=entry.th32ParentProcessID;break;}}while(Process32NextW(snapshot.value,&entry));
  if(!parentPid)return false;
  CreationHandle parent(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,parentPid));
  if(!parent.value)return false;
  const auto parentCreated=processCreation(parent.value);if(!parentCreated)return false;
  const auto name=descendantCreationName(owner,parentPid,parentCreated);
  CreationHandle section(OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str()));
  if(!section.value){if(GetLastError()==ERROR_FILE_NOT_FOUND)return false;throw std::runtime_error("creation reservation cannot be read");}
  CreationHandle writer(OpenMutexW(SYNCHRONIZE|MUTEX_MODIFY_STATE,FALSE,(name+L".writer").c_str()));
  if(!writer.value)throw std::runtime_error("creation reservation writer unavailable");
  CreationView view;view.value=static_cast<SakuraCreationRegistry*>(MapViewOfFile(section.value,FILE_MAP_READ,0,0,sizeof(SakuraCreationRegistry)));
  if(!view.value)throw std::runtime_error("creation reservation view unavailable");
  CreationLock lock(writer.value);
  if(!descendantCreationValid(*view.value,parentPid,parentCreated))throw std::runtime_error("creation reservation identity differs");
  for(const auto& token:view.value->jobs){
    if(!token.low && !token.high)continue;
    CreationHandle job(OpenJobObjectW(JOB_OBJECT_QUERY,FALSE,descendantCreationJob(name,token).c_str()));
    if(!job.value){if(GetLastError()==ERROR_FILE_NOT_FOUND)continue;throw std::runtime_error("creation reservation Job unavailable");}
    BOOL member=FALSE;
    if(!IsProcessInJob(process.value,job.value,&member))throw std::runtime_error("creation reservation membership unavailable");
    if(member)return true;
  }
  return false;
}
