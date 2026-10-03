#pragma once
#include "descendant.h"
#include <condition_variable>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <chrono>
#include <sstream>
#include <ole2.h>

struct DescendantPending {
  HANDLE job;
  bool complete=false,success=false;
  std::condition_variable changed;
  explicit DescendantPending(HANDLE value):job(value){}
};
static std::mutex descendantPendingLock,descendantOutputLock;
static std::map<std::string,std::shared_ptr<DescendantPending>> descendantPending;
static HANDLE descendantAcquire(HANDLE source,uint64_t token) {
  HANDLE result=nullptr;
  if(!token || token>UINTPTR_MAX || !DuplicateHandle(source,reinterpret_cast<HANDLE>(uintptr_t(token)),GetCurrentProcess(),&result,0,FALSE,DUPLICATE_SAME_ACCESS))
    throw std::runtime_error("descendant exact handle copy unavailable");
  return result;
}
static std::wstring descendantNonce() {
  GUID value{};if(FAILED(CoCreateGuid(&value)))throw std::runtime_error("descendant request id unavailable");
  wchar_t text[40]{};if(!StringFromGUID2(value,text,40))throw std::runtime_error("descendant request id unavailable");
  std::wstring result(text);result=result.substr(1,36);
  for(auto& character:result)if(character>=L'A' && character<=L'F')character+=L'a'-L'A';
  return result;
}
static void descendantClient(HANDLE input,std::wstring owner) {
  Handle pipe(input),parent(nullptr),process(nullptr),thread(nullptr),job(nullptr),file(nullptr),reservation(nullptr);
  SakuraDescendantReply reply{SakuraDescendantMagic,SakuraDescendantVersion,ERROR_ACCESS_DENIED,0};
  std::string requestId,denial;bool committed=false,cleanupRequested=false;
  try {
    ULONG clientPid=0;
    if(!GetNamedPipeClientProcessId(pipe.value,&clientPid) || !clientPid)throw std::runtime_error("descendant pipe caller unavailable");
    parent.value=OpenProcess(PROCESS_DUP_HANDLE|PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,clientPid);
    DWORD clientSession=0,ownSession=0;
    if(!parent.value || !ownUser(parent.value) || !ProcessIdToSessionId(clientPid,&clientSession) ||
        !ProcessIdToSessionId(GetCurrentProcessId(),&ownSession) || clientSession!=ownSession)throw std::runtime_error("descendant pipe caller differs");
    SakuraDescendantRequest request{};
    if(!descendantTransfer(pipe.value,&request,sizeof(request),false,15000) ||
        request.magic!=SakuraDescendantMagic || request.version!=SakuraDescendantVersion || request.parentPid!=clientPid ||
        request.suspended>1 || !request.parentCreated || processCreation(parent.value)!=request.parentCreated)
      throw std::runtime_error("descendant caller identity changed");
    reservation.value=OpenFileMappingW(FILE_MAP_READ,FALSE,descendantCreationName(owner,clientPid,request.parentCreated).c_str());
    if(!reservation.value)throw std::runtime_error("descendant creation reservation unavailable");
    process.value=descendantAcquire(parent.value,request.process);thread.value=descendantAcquire(parent.value,request.thread);
    job.value=descendantAcquire(parent.value,request.job);file.value=descendantAcquire(parent.value,request.file);
    const DWORD pid=GetProcessId(process.value);const auto created=processCreation(process.value);const auto architecture=bits(process.value);
    BOOL inJob=FALSE;JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
    if(!pid || !created || (architecture!=32 && architecture!=64) || GetProcessIdOfThread(thread.value)!=pid ||
        !IsProcessInJob(process.value,job.value,&inJob) || !inJob || !ownUser(process.value) ||
        !ProcessIdToSessionId(pid,&clientSession) || clientSession!=ownSession || WaitForSingleObject(process.value,0)!=WAIT_TIMEOUT ||
        !QueryInformationJobObject(job.value,JobObjectBasicAccountingInformation,&accounting,sizeof(accounting),nullptr) ||
        accounting.TotalProcesses!=1 || accounting.ActiveProcesses!=1 || accounting.TotalTerminatedProcesses)
      throw std::runtime_error("descendant exact suspended handles differ");
    primarySuspended(thread.value);
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0));PROCESSENTRY32W entry{};entry.dwSize=sizeof(entry);bool ancestry=false;
    if(snapshot.value!=INVALID_HANDLE_VALUE && Process32FirstW(snapshot.value,&entry))do{
      if(entry.th32ProcessID==pid){ancestry=entry.th32ParentProcessID==clientPid;break;}
    }while(Process32NextW(snapshot.value,&entry));
    if(!ancestry)throw std::runtime_error("descendant OS parent differs");
    const auto expected=image(process.value);const auto digest=fileDigest(file.value);const std::wstring wideDigest(digest.begin(),digest.end());
    selectedFile(file.value,expected,wideDigest);
    // The exact caller must already own an active, compatible policy, even
    // when it is currently executing an original import/TLS initializer.
    Handle section(OpenFileMappingW(FILE_MAP_READ,FALSE,mapping(owner.c_str(),clientPid,request.parentCreated).c_str()));
    const auto policy=section.value?static_cast<const SakuraClipboardPolicy*>(MapViewOfFile(section.value,FILE_MAP_READ,0,0,sizeof(SakuraClipboardPolicy))):nullptr;
    const bool allowed=policy && policy->magic==SakuraClipboardMagic && policy->version==SakuraClipboardVersion &&
      policy->pid==clientPid && policy->creationTime==request.parentCreated && !(policy->sequence&1) && policy->status==1 &&
      policy->active && std::memcmp(policy->build,SAKURA_CLIPBOARD_BUILD,65)==0;
    if(policy)UnmapViewOfFile(policy);if(!allowed)throw std::runtime_error("descendant caller has no active policy");
    const auto nonce=descendantNonce();requestId=utf8(nonce);auto pending=std::make_shared<DescendantPending>(job.value);
    {std::lock_guard<std::mutex> lock(descendantPendingLock);descendantPending.emplace(requestId,pending);}
    {
      std::lock_guard<std::mutex> lock(descendantOutputLock);
      std::cout<<"{\"stage\":\"request\",\"id\":"<<json(nonce)<<",\"parent\":";
      printIdentity(clientPid,request.parentCreated,image(parent.value),bits(parent.value));std::cout<<",\"process\":";
      printIdentity(pid,created,expected,architecture);
      std::cout<<",\"sha256\":\""<<digest<<"\",\"suspended\":"<<(request.suspended?"true":"false")
        <<",\"handles\":{\"process\":\""<<uint64_t(uintptr_t(process.value))<<"\",\"thread\":\""<<uint64_t(uintptr_t(thread.value))
        <<"\",\"job\":\""<<uint64_t(uintptr_t(job.value))<<"\",\"file\":\""<<uint64_t(uintptr_t(file.value))<<"\"}}"<<std::endl;published();
    }
    {
      std::unique_lock<std::mutex> lock(descendantPendingLock);
      const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(120);
      while(!pending->complete){
        DWORD unread=0;
        if(denial.empty() && (WaitForSingleObject(parent.value,0)!=WAIT_TIMEOUT || !PeekNamedPipe(pipe.value,nullptr,0,nullptr,&unread,nullptr)))
          denial="descendant caller ended before authorization";
        if(denial.empty() && std::chrono::steady_clock::now()>=deadline)denial="descendant authorization timeout";
        if(!denial.empty() && !cleanupRequested){TerminateJobObject(job.value,1);cleanupRequested=true;}
        // Keep these exact handle copies until the service request settles.
        // Otherwise a delayed helper could duplicate a recycled broker token.
        pending->changed.wait_for(lock,std::chrono::milliseconds(20),[&]{return pending->complete;});
      }
      DWORD unread=0;
      if(denial.empty() && (WaitForSingleObject(parent.value,0)!=WAIT_TIMEOUT || !PeekNamedPipe(pipe.value,nullptr,0,nullptr,&unread,nullptr)))
        denial="descendant caller ended before authorization";
      committed=pending->success && denial.empty();descendantPending.erase(requestId);requestId.clear();
    }
    if(!denial.empty())throw std::runtime_error(denial);
    if(!committed)throw std::runtime_error("descendant service rejected policy");
    reply.error=0;
  } catch(const std::exception& failure) {
    if(!requestId.empty()){std::lock_guard<std::mutex> lock(descendantPendingLock);descendantPending.erase(requestId);}
    if(job.value)TerminateJobObject(job.value,1);
    const std::string message=failure.what();
    if(message!="descendant service rejected policy"){
      std::lock_guard<std::mutex> lock(descendantOutputLock);
      std::cout<<"{\"stage\":\"rejected\",\"parentPid\":"<<(parent.value?GetProcessId(parent.value):0)
        <<",\"error\":"<<json(std::wstring(message.begin(),message.end()))<<'}'<<std::endl;
    }
  } catch(...) {
    if(!requestId.empty()){std::lock_guard<std::mutex> lock(descendantPendingLock);descendantPending.erase(requestId);}
    if(job.value)TerminateJobObject(job.value,1);
  }
  // Failure to deliver a success is ambiguous to the caller. It may choose to
  // terminate its own exact child, while the service keeps the durable journal.
  descendantTransfer(pipe.value,&reply,sizeof(reply),true,15000);
  uint32_t acknowledged=0;
  if(!reply.error)descendantTransfer(pipe.value,&acknowledged,sizeof(acknowledged),false,5000);
  DisconnectNamedPipe(pipe.value);
}
static void descendantBroker(const std::wstring& owner) {
  mapping(owner.c_str(),1,1);
  const auto token=user(GetCurrentProcess());wchar_t* sid=nullptr;
  if(!ConvertSidToStringSidW(reinterpret_cast<const TOKEN_USER*>(token.data())->User.Sid,&sid))throw std::runtime_error("descendant broker ACL unavailable");
  const std::wstring text=L"D:P(A;;GA;;;"+std::wstring(sid)+L")(A;;GA;;;SY)";LocalFree(sid);
  PSECURITY_DESCRIPTOR security=nullptr;
  if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(text.c_str(),SDDL_REVISION_1,&security,nullptr))throw std::runtime_error("descendant broker ACL unavailable");
  SECURITY_ATTRIBUTES acl{sizeof(acl),security,FALSE};
  const auto pipeName=L"\\\\.\\pipe\\SakuraClipboard.Descendants."+owner+L"."+descendantNonce();
  const auto create=[&](bool first){return CreateNamedPipeW(pipeName.c_str(),PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED|(first?FILE_FLAG_FIRST_PIPE_INSTANCE:0),
    PIPE_TYPE_MESSAGE|PIPE_READMODE_MESSAGE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,64,4096,4096,15000,&acl);};
  Handle pipe(create(true));
  if(pipe.value==INVALID_HANDLE_VALUE){LocalFree(security);throw std::runtime_error("descendant broker pipe unavailable");}
  const auto endpointName=descendantEndpointName(owner);
  Handle endpoint(CreateFileMappingW(INVALID_HANDLE_VALUE,&acl,PAGE_READWRITE,0,sizeof(SakuraDescendantEndpoint),endpointName.c_str()));
  const DWORD error=GetLastError();
  if(!endpoint.value || error==ERROR_ALREADY_EXISTS){LocalFree(security);throw std::runtime_error("descendant broker owner already active");}
  const auto data=static_cast<SakuraDescendantEndpoint*>(MapViewOfFile(endpoint.value,FILE_MAP_ALL_ACCESS,0,0,sizeof(SakuraDescendantEndpoint)));
  if(!data){LocalFree(security);throw std::runtime_error("descendant broker endpoint unavailable");}
  SakuraDescendantEndpoint config{};config.magic=SakuraDescendantMagic;config.version=SakuraDescendantVersion;
  config.pid=GetCurrentProcessId();config.creationTime=processCreation(GetCurrentProcess());std::memcpy(config.build,SAKURA_CLIPBOARD_BUILD,65);
  std::copy(pipeName.begin(),pipeName.end(),config.pipe);std::memcpy(data,&config,sizeof(config));UnmapViewOfFile(data);
  std::cout<<"{\"stage\":\"ready\",\"pid\":"<<config.pid<<",\"created\":\""<<config.creationTime<<"\"}"<<std::endl;published();
  std::thread([]{
    std::string line;
    while(std::getline(std::cin,line)){
      std::istringstream fields(line);std::string action,id,extra;fields>>action>>id;
      if((action!="ok" && action!="fail") || id.size()!=36 || fields>>extra)break;
      std::lock_guard<std::mutex> lock(descendantPendingLock);const auto found=descendantPending.find(id);
      if(found!=descendantPending.end()){found->second->complete=true;found->second->success=action=="ok";found->second->changed.notify_one();}
    }
    // EOF must abort every still-uncommitted child. This process owns only
    // descendant Jobs made for this broker's exact in-flight requests.
    std::lock_guard<std::mutex> lock(descendantPendingLock);
    for(const auto& entry:descendantPending)TerminateJobObject(entry.second->job,1);
    ExitProcess(0);
  }).detach();
  for(;;) {
    Handle event(CreateEventW(nullptr,TRUE,FALSE,nullptr));OVERLAPPED operation{};operation.hEvent=event.value;
    const BOOL connected=ConnectNamedPipe(pipe.value,&operation);const DWORD result=GetLastError();
    if(!connected && result!=ERROR_PIPE_CONNECTED && (result!=ERROR_IO_PENDING || WaitForSingleObject(event.value,INFINITE)!=WAIT_OBJECT_0))
      throw std::runtime_error("descendant broker connection unavailable");
    HANDLE accepted=pipe.value;
    pipe.value=create(false);
    if(pipe.value==INVALID_HANDLE_VALUE){CloseHandle(accepted);throw std::runtime_error("descendant broker capacity exhausted");}
    std::thread(descendantClient,accepted,owner).detach();
  }
}
static HANDLE descendantDuplicate(HANDLE source,const wchar_t* value) {
  return descendantAcquire(source,number(value));
}
static void descendantAdopt(const wchar_t* owner,const std::wstring& expected,const std::wstring& digest,const std::wstring& library,
    uint32_t flags,uint32_t maximum,const std::wstring& nonce,DWORD brokerPid,uint64_t brokerCreated,
    const wchar_t* processToken,const wchar_t* threadToken,const wchar_t* jobToken,const wchar_t* fileToken,bool suspended,DWORD parentPid,uint64_t parentCreated) {
  mapping(owner,1,1);mapping(nonce.c_str(),1,1);
  if(flags>15 || maximum<1024 || maximum>1048576)throw std::runtime_error("invalid descendant policy");
  Handle broker(OpenProcess(PROCESS_DUP_HANDLE|PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,brokerPid));
  if(!broker.value || processCreation(broker.value)!=brokerCreated || !ownUser(broker.value) || WaitForSingleObject(broker.value,0)!=WAIT_TIMEOUT)
    throw std::runtime_error("descendant broker identity changed");
  Handle process(descendantDuplicate(broker.value,processToken)),thread(descendantDuplicate(broker.value,threadToken)),
    job(descendantDuplicate(broker.value,jobToken)),file(descendantDuplicate(broker.value,fileToken));
  Handle parent(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,parentPid));
  const DWORD pid=GetProcessId(process.value);const uint64_t creation=processCreation(process.value);const unsigned architecture=bits(process.value);
  try {
    const auto check=[&]{BOOL inJob=FALSE;DWORD targetSession=0,ownSession=0;
      Handle endpoint(OpenFileMappingW(FILE_MAP_READ,FALSE,descendantEndpointName(owner).c_str()));
      const auto current=endpoint.value?static_cast<const SakuraDescendantEndpoint*>(MapViewOfFile(endpoint.value,FILE_MAP_READ,0,0,sizeof(SakuraDescendantEndpoint))):nullptr;
      const bool brokerCurrent=current && current->magic==SakuraDescendantMagic && current->version==SakuraDescendantVersion &&
        current->pid==brokerPid && current->creationTime==brokerCreated && std::memcmp(current->build,SAKURA_CLIPBOARD_BUILD,65)==0;
      if(current)UnmapViewOfFile(current);
      if(!brokerCurrent || processCreation(broker.value)!=brokerCreated || WaitForSingleObject(broker.value,0)!=WAIT_TIMEOUT)
        throw std::runtime_error("descendant broker generation changed");
      if(!parent.value || !parentPid || !parentCreated || processCreation(parent.value)!=parentCreated || !ownUser(parent.value) ||
          WaitForSingleObject(parent.value,0)!=WAIT_TIMEOUT)throw std::runtime_error("descendant exact parent ended before commit");
      if(!pid || !creation || architecture!=sizeof(void*)*8 || processCreation(process.value)!=creation || !same(image(process.value),expected) ||
          !ownUser(process.value) || !ProcessIdToSessionId(pid,&targetSession) || !ProcessIdToSessionId(GetCurrentProcessId(),&ownSession) || targetSession!=ownSession ||
          GetProcessIdOfThread(thread.value)!=pid || !IsProcessInJob(process.value,job.value,&inJob) || !inJob || WaitForSingleObject(process.value,0)!=WAIT_TIMEOUT)
        throw std::runtime_error("descendant process identity changed");primarySuspended(thread.value);};
    check();selectedFile(file.value,expected,digest);selectedExecutable(file.value);
    using InspectPackage=LONG(WINAPI*)(HANDLE,UINT32*,PWSTR);
    const auto inspectPackage=reinterpret_cast<InspectPackage>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"GetPackageFullName"));UINT32 length=0;
    if(!inspectPackage || inspectPackage(process.value,&length,nullptr)!=APPMODEL_ERROR_NO_PACKAGE)throw std::runtime_error("descendant requires an unpackaged executable");
    const auto imported=importPath(library);earlyDependencies(expected,library);
    std::cout<<"{\"stage\":\"prepared\",\"launchId\":"<<json(nonce)<<",\"process\":";printIdentity(pid,creation,expected,architecture);std::cout<<'}'<<std::endl;published();
    permission(nonce,"attach");check();
    Handle policyFile(CreateFileW(library.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
    if(policyFile.value==INVALID_HANDLE_VALUE)throw std::runtime_error("descendant early policy file unavailable");
    const auto policyDigest=fileDigest(policyFile.value);const std::wstring policyHash(policyDigest.begin(),policyDigest.end());selectedFile(policyFile.value,library,policyHash);
    EarlyPolicy early(owner,pid,creation,flags,maximum);earlyDependencies(expected,library);early.insert(process.value,imported);check();
    initializeLoader(process.value,pid);early.ready();check();if(!module(pid,library))throw std::runtime_error("descendant early policy image differs");
    std::cout<<"{\"stage\":\"attached\",\"launchId\":"<<json(nonce)<<",\"process\":";printIdentity(pid,creation,expected,architecture);std::cout<<",\"state\":";
    state(owner,pid,creation,false);std::cout<<'}'<<std::endl;published();permission(nonce,"resume");
    check();early.ready();selectedFile(file.value,expected,digest);selectedFile(policyFile.value,library,policyHash);
    if(!suspended && ResumeThread(thread.value)!=1)throw std::runtime_error("descendant primary thread could not resume");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    if(!SetInformationJobObject(job.value,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))throw std::runtime_error("descendant job could not commit");
    std::cout<<"{\"stage\":\"committed\",\"launchId\":"<<json(nonce)<<",\"process\":";printIdentity(pid,creation,expected,architecture);std::cout<<'}'<<std::endl;published();
  }catch(...){TerminateJobObject(job.value,1);WaitForSingleObject(process.value,30000);throw;}
}
