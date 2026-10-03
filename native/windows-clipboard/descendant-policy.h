#pragma once
#include "descendant.h"
#include "descendant-reservation.h"
#include <memory>

using DescendantCreateW=BOOL(WINAPI*)(LPCWSTR,LPWSTR,LPSECURITY_ATTRIBUTES,LPSECURITY_ATTRIBUTES,BOOL,DWORD,LPVOID,LPCWSTR,LPSTARTUPINFOW,LPPROCESS_INFORMATION);
using DescendantCreateA=BOOL(WINAPI*)(LPCSTR,LPSTR,LPSECURITY_ATTRIBUTES,LPSECURITY_ATTRIBUTES,BOOL,DWORD,LPVOID,LPCSTR,LPSTARTUPINFOA,LPPROCESS_INFORMATION);
static DescendantCreateW originalProcessW=nullptr;
static DescendantCreateA originalProcessA=nullptr;
struct DescendantHandle {
  HANDLE value;
  explicit DescendantHandle(HANDLE input=nullptr):value(input){}
  ~DescendantHandle(){if(value && value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
  DescendantHandle(const DescendantHandle&)=delete;
};
static std::wstring descendantWide(const char* value) {
  if(!value)return {};
  const int size=MultiByteToWideChar(CP_ACP,0,value,-1,nullptr,0);
  if(size<=0)throw std::runtime_error("child ANSI path unavailable");
  std::wstring answer(size,L'\0');
  if(!MultiByteToWideChar(CP_ACP,0,value,-1,answer.data(),size))throw std::runtime_error("child ANSI path unavailable");
  answer.resize(size-1);return answer;
}
static std::wstring descendantFilePath(HANDLE file) {
  std::wstring path(32768,L'\0');
  const DWORD size=GetFinalPathNameByHandleW(file,path.data(),DWORD(path.size()),FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
  if(!size || size>=path.size())return {};
  path.resize(size);if(path.rfind(L"\\\\?\\",0)==0)path.erase(0,4);return path;
}
// Pin possible executable resolutions before CreateProcess, then require that
// the OS-selected image is one of those exact locked files. This supports an
// explicit application name and the documented quoted/unquoted command search.
// A replacement cannot make the persisted digest describe a different image.
static HANDLE descendantPinCandidate(const std::wstring& value,bool search) {
  std::wstring name=value;
  const auto slash=name.find_last_of(L"\\/");
  if(name.find(L'.',slash==std::wstring::npos?0:slash+1)==std::wstring::npos)name+=L".exe";
  std::vector<std::wstring> paths;
  if(!search || name.find_first_of(L"\\/:")!=std::wstring::npos)paths.push_back(name);
  else {
    wchar_t folder[32768]{};
    DWORD length=GetModuleFileNameW(nullptr,folder,32768);
    if(length && length<32768){std::wstring parent(folder,length);const auto last=parent.find_last_of(L"\\/");if(last!=std::wstring::npos)paths.push_back(parent.substr(0,last+1)+name);}
    length=GetCurrentDirectoryW(32768,folder);if(length && length<32768)paths.push_back(std::wstring(folder,length)+L"\\"+name);
    length=GetSystemDirectoryW(folder,32768);if(length && length<32768)paths.push_back(std::wstring(folder,length)+L"\\"+name);
    length=GetWindowsDirectoryW(folder,32768);if(length && length<32768){paths.push_back(std::wstring(folder,length)+L"\\System\\"+name);paths.push_back(std::wstring(folder,length)+L"\\"+name);}
    length=GetEnvironmentVariableW(L"PATH",folder,32768);
    if(length && length<32768){std::wstring all(folder,length);size_t start=0;while(start<=all.size()){
      const auto end=all.find(L';',start);std::wstring part=all.substr(start,end==std::wstring::npos?end:end-start);
      if(part.size()>1 && part.front()==L'"' && part.back()==L'"')part=part.substr(1,part.size()-2);
      if(!part.empty())paths.push_back(part+L"\\"+name);
      if(end==std::wstring::npos)break;start=end+1;
    }}
  }
  for(const auto& path:paths) {
    HANDLE file=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    if(file!=INVALID_HANDLE_VALUE){BY_HANDLE_FILE_INFORMATION info{};if(GetFileInformationByHandle(file,&info) && !(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT)))return file;CloseHandle(file);}
  }
  return nullptr;
}
struct DescendantPins {
  std::vector<HANDLE> files;
  ~DescendantPins(){for(HANDLE file:files)CloseHandle(file);}
  void remember(HANDLE file) {
    if(!file)return;
    try{files.push_back(file);}catch(...){CloseHandle(file);throw;}
  }
  DescendantPins(const std::wstring& application,const std::wstring& command) {
    if(!application.empty()){remember(descendantPinCandidate(application,false));return;}
    size_t start=command.find_first_not_of(L" \t");if(start==std::wstring::npos)return;
    if(command[start]==L'"') {
      const auto end=command.find(L'"',start+1);
      if(end!=std::wstring::npos)remember(descendantPinCandidate(command.substr(start+1,end-start-1),true));
      return;
    }
    for(size_t end=start;end<=command.size() && files.size()<64;++end) {
      if(end<command.size() && command[end]!=L' ' && command[end]!=L'\t')continue;
      if(end>start)remember(descendantPinCandidate(command.substr(start,end-start),true));
      if(files.size() || end==command.size())break;
    }
  }
  HANDLE matching(HANDLE process) {
    std::wstring image(32768,L'\0');DWORD size=DWORD(image.size());
    if(!QueryFullProcessImageNameW(process,0,image.data(),&size))return nullptr;image.resize(size);
    for(HANDLE file:files){const auto path=descendantFilePath(file);if(!path.empty() && CompareStringOrdinal(path.c_str(),-1,image.c_str(),-1,TRUE)==CSTR_EQUAL)return file;}
    return nullptr;
  }
};
struct DescendantAttributes {
  LPPROC_THREAD_ATTRIBUTE_LIST value;
  ~DescendantAttributes(){if(value)DeleteProcThreadAttributeList(value);}
};
template<class Startup,class Extended,class Call>
static BOOL descendantCreate(const std::wstring& application,const std::wstring& command,DWORD flags,
    Startup* startup,PROCESS_INFORMATION* output,Call call) {
  if(!current().active)return call(flags,startup,output);
  // Windows exposes no API for cloning an opaque caller attribute list and
  // adding a creation-time Job. Refuse that unsupported path explicitly.
  if(!startup || !output || startup->cb!=sizeof(Startup) ||
      flags&(EXTENDED_STARTUPINFO_PRESENT|DEBUG_PROCESS|DEBUG_ONLY_THIS_PROCESS)){
    SetLastError(ERROR_NOT_SUPPORTED);return FALSE;
  }
  DWORD failure=ERROR_ACCESS_DENIED;PROCESS_INFORMATION child{};
  DescendantHandle job,pipe,broker,endpointSection;
  std::unique_ptr<DescendantReservation> reservation;
  try {
    const std::wstring prefix=L"Local\\SakuraClipboard.";
    if(sectionName.rfind(prefix,0)!=0 || sectionName.size()<prefix.size()+37)throw std::runtime_error("child policy owner unavailable");
    const auto name=descendantEndpointName(sectionName.substr(prefix.size(),36));
    endpointSection.value=OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str());
    if(!endpointSection.value)throw std::runtime_error("child policy broker unavailable");
    const auto data=static_cast<const SakuraDescendantEndpoint*>(MapViewOfFile(endpointSection.value,FILE_MAP_READ,0,0,sizeof(SakuraDescendantEndpoint)));
    if(!data)throw std::runtime_error("child broker endpoint unavailable");
    const SakuraDescendantEndpoint endpoint=*data;UnmapViewOfFile(data);
    CloseHandle(endpointSection.value);endpointSection.value=nullptr;
    if(endpoint.magic!=SakuraDescendantMagic || endpoint.version!=SakuraDescendantVersion || endpoint.reserved ||
        !endpoint.pid || !endpoint.creationTime || std::memcmp(endpoint.build,SAKURA_CLIPBOARD_BUILD,65) ||
        std::find(endpoint.pipe,endpoint.pipe+192,L'\0')==endpoint.pipe+192)throw std::runtime_error("child broker endpoint differs");
    broker.value=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,endpoint.pid);
    if(!broker.value || processCreation(broker.value)!=endpoint.creationTime || WaitForSingleObject(broker.value,0)!=WAIT_TIMEOUT)
      throw std::runtime_error("child broker identity changed");
    for(unsigned attempt=0;attempt<8;++attempt){
      pipe.value=CreateFileW(endpoint.pipe,GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,FILE_FLAG_OVERLAPPED|SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,nullptr);
      if(pipe.value!=INVALID_HANDLE_VALUE)break;
      if(GetLastError()!=ERROR_PIPE_BUSY || !WaitNamedPipeW(endpoint.pipe,5000))break;
    }
    ULONG serverPid=0;
    if(pipe.value==INVALID_HANDLE_VALUE || !GetNamedPipeServerProcessId(pipe.value,&serverPid) || serverPid!=endpoint.pid ||
        processCreation(broker.value)!=endpoint.creationTime)throw std::runtime_error("child pipe owner differs");
    reservation=std::make_unique<DescendantReservation>(sectionName.substr(prefix.size(),36));
    job.value=reservation->releaseJob();
    SIZE_T size=0;InitializeProcThreadAttributeList(nullptr,1,0,&size);
    std::vector<unsigned char> storage(size);auto attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
    if(!size || !InitializeProcThreadAttributeList(attributes,1,0,&size))throw std::runtime_error("child attributes unavailable");
    DescendantAttributes attributeOwner{attributes};
    const BOOL assigned=UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,&job.value,sizeof(HANDLE),nullptr,nullptr);
    Extended extended{};extended.StartupInfo=*startup;extended.StartupInfo.cb=sizeof(Extended);extended.lpAttributeList=attributes;
    DescendantPins pins(application,command);
    const BOOL created=assigned && call(flags|CREATE_SUSPENDED|EXTENDED_STARTUPINFO_PRESENT,&extended.StartupInfo,&child);
    failure=GetLastError();DeleteProcThreadAttributeList(attributes);attributeOwner.value=nullptr;
    if(!created){SetLastError(failure);return FALSE;}
    failure=ERROR_ACCESS_DENIED;HANDLE imageFile=pins.matching(child.hProcess);
    if(!imageFile)throw std::runtime_error("OS-selected child image was not locked before creation");
    SakuraDescendantRequest request{SakuraDescendantMagic,SakuraDescendantVersion,GetCurrentProcessId(),(flags&CREATE_SUSPENDED)?1u:0u,
      processCreation(GetCurrentProcess()),uint64_t(uintptr_t(child.hProcess)),uint64_t(uintptr_t(child.hThread)),uint64_t(uintptr_t(job.value)),uint64_t(uintptr_t(imageFile))};
    if(!descendantTransfer(pipe.value,&request,sizeof(request),true))throw std::runtime_error("child handoff unavailable");
    SakuraDescendantReply reply{};
    if(!descendantTransfer(pipe.value,&reply,sizeof(reply),false) || reply.magic!=SakuraDescendantMagic || reply.version!=SakuraDescendantVersion || reply.reserved || reply.error)throw std::runtime_error("child policy was not committed");
    uint32_t acknowledged=SakuraDescendantMagic;
    descendantTransfer(pipe.value,&acknowledged,sizeof(acknowledged),true,5000);
    *output=child;return TRUE;
  } catch(...) {
    if(child.hProcess){if(job.value)TerminateJobObject(job.value,1);else TerminateProcess(child.hProcess,1);WaitForSingleObject(child.hProcess,30000);CloseHandle(child.hThread);CloseHandle(child.hProcess);}
    SetLastError(failure);return FALSE;
  }
}
static BOOL WINAPI descendantCreateW(LPCWSTR application,LPWSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity,
    BOOL inherit,DWORD flags,LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output) {
  if(!current().active)return originalProcessW(application,command,processSecurity,threadSecurity,inherit,flags,environment,directory,startup,output);
  try{return descendantCreate<STARTUPINFOW,STARTUPINFOEXW>(application?application:L"",command?command:L"",flags,startup,output,
    [&](DWORD actual,LPSTARTUPINFOW info,LPPROCESS_INFORMATION result){return originalProcessW(application,command,processSecurity,threadSecurity,inherit,actual,environment,directory,info,result);});}
  catch(...){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}
}
static BOOL WINAPI descendantCreateA(LPCSTR application,LPSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity,
    BOOL inherit,DWORD flags,LPVOID environment,LPCSTR directory,LPSTARTUPINFOA startup,LPPROCESS_INFORMATION output) {
  if(!current().active)return originalProcessA(application,command,processSecurity,threadSecurity,inherit,flags,environment,directory,startup,output);
  try{return descendantCreate<STARTUPINFOA,STARTUPINFOEXA>(descendantWide(application),descendantWide(command),flags,startup,output,
    [&](DWORD actual,LPSTARTUPINFOA info,LPPROCESS_INFORMATION result){return originalProcessA(application,command,processSecurity,threadSecurity,inherit,actual,environment,directory,info,result);});}
  catch(...){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}
}
