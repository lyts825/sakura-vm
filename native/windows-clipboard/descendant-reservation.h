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
  explicit CreationHandle(HANDLE input=nullptr):value(input){}
  ~CreationHandle(){if(value && value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
  CreationHandle(const CreationHandle&)=delete;
};
struct CreationView {
  SakuraCreationRegistry* value=nullptr;
  ~CreationView(){if(value)UnmapViewOfFile(value);}
};
struct CreationLock {
  HANDLE value;
  explicit CreationLock(HANDLE mutex):value(mutex) {
    const DWORD result=WaitForSingleObject(value,15000);
    if(result!=WAIT_OBJECT_0 && result!=WAIT_ABANDONED)throw std::runtime_error("creation reservation writer unavailable");
  }
  ~CreationLock(){ReleaseMutex(value);}
};
inline std::wstring descendantCreationName(const std::wstring& owner,DWORD pid,uint64_t created) {
  return L"Local\\SakuraClipboard.Creation."+owner+L"."+std::to_wstring(pid)+L"."+std::to_wstring(created);
}
inline std::wstring descendantCreationJob(const std::wstring& name,const SakuraCreationToken& token) {
  constexpr wchar_t digits[]=L"0123456789abcdef";
  std::wstring result=name+L".job.";
  for(const uint64_t part:{token.low,token.high})for(int shift=60;shift>=0;shift-=4)result+=digits[(part>>shift)&15];
  return result;
}
inline bool descendantCreationValid(const SakuraCreationRegistry& value,DWORD pid,uint64_t created) {
  return value.magic==SakuraCreationMagic && value.version==SakuraCreationVersion && !value.reserved &&
    value.parentPid==pid && value.parentCreated==created && std::memcmp(value.build,SAKURA_CLIPBOARD_BUILD,65)==0;
}
class DescendantReservation {
  CreationHandle section,writer,job;
  CreationView view;
  size_t slot=SakuraCreationCapacity;
public:
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
  HANDLE releaseJob(){const HANDLE result=job.value;job.value=nullptr;return result;}
  ~DescendantReservation(){
    if(view.value && slot<SakuraCreationCapacity)try{CreationLock lock(writer.value);view.value->jobs[slot]={};MemoryBarrier();}catch(...){}
  }
  DescendantReservation(const DescendantReservation&)=delete;
};
// Read-only OS identity and exact named Job membership. Called before ordinary
// apply creates a policy mapping or starts any remote loader/configure thread.
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
