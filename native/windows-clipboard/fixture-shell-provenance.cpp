#define _WIN32_WINNT 0x0A00
#include "fixture-shell.h"
#include "shell-provenance.h"
#include <thread>
#include <stdexcept>

static void require(bool value){if(!value)throw std::runtime_error("Shell attribute lifecycle assertion failed");}
struct ModelTable {
  std::vector<unsigned char> storage;
  LPPROC_THREAD_ATTRIBUTE_LIST list=nullptr;
  explicit ModelTable(DWORD capacity) {
    SIZE_T size=0;InitializeProcThreadAttributeList(nullptr,capacity,0,&size);require(size!=0);storage.resize(size);
    list=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());require(InitializeProcThreadAttributeList(list,capacity,0,&size)!=FALSE);
  }
  ~ModelTable(){if(list)DeleteProcThreadAttributeList(list);}
};
static BOOL WINAPI modelUpdateFailure(LPPROC_THREAD_ATTRIBUTE_LIST,DWORD,DWORD_PTR,PVOID,SIZE_T,PVOID,PSIZE_T){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}
static HANDLE* modelExpectedJob=nullptr;
static bool modelJobLiveAtDelete=false;
static VOID WINAPI modelDeleteCheck(LPPROC_THREAD_ATTRIBUTE_LIST list) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION state{};
  modelJobLiveAtDelete=modelExpectedJob && *modelExpectedJob && QueryInformationJobObject(*modelExpectedJob,JobObjectBasicAccountingInformation,&state,sizeof(state),nullptr);
  DeleteProcThreadAttributeList(list);
}
int wmain() {
  try{
    const auto station=shellPrivateStation(),pipeName=shellArgument(L"--shell-pipe=");
    if(std::wcsstr(GetCommandLineW(),L"--cleanup-child")){
      const auto marker=shellArgument(L"--shell-cleanup-marker=");
      HANDLE file=CreateFileW(marker.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);
      Sleep(INFINITE);return 95;
    }
    std::string cases="[";unsigned total=0;const DWORD thread=GetCurrentThreadId();
    const auto passed=[&](const char* name){if(total++)cases+=',';cases+='"'+std::string(name)+'"';};
    {
      ShellAttributeLedger ledger;ModelTable table(2);
      require(!ledger.claim(table.list,1,thread));passed("unobserved-init-is-not-a-Shell-table");
      require(!ledger.initialized(table.list,2,0,1,thread,false,true));passed("caller-opaque-init-is-refused");
      require(!ledger.initialized(table.list,2,0,0,thread,true,true));passed("init-outside-explicit-scope-is-refused");
      require(!ledger.initialized(table.list,2,0,1,thread,true,false));passed("failed-init-is-not-adopted");
      auto record=ledger.initialized(table.list,2,0,1,thread,true,true);require(bool(record));
      require(!ledger.claim(table.list,2,thread));passed("scope-generation-cannot-be-reused");
      require(!ledger.claim(table.list,1,thread+1));passed("cross-thread-claim-is-refused");
      ledger.deleted(table.list,1,thread,true,&DeleteProcThreadAttributeList);table.list=nullptr;
      require(!ledger.completed({record}));passed("Shell-success-with-zero-child-is-refused");
    }
    {
      ShellAttributeLedger ledger;ModelTable table(1);DWORD policy=0;
      auto record=ledger.initialized(table.list,1,0,1,thread,true,true);require(bool(record));
      const BOOL updated=UpdateProcThreadAttribute(table.list,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,&policy,sizeof(policy),nullptr,nullptr);
      require(updated!=FALSE);ledger.updated(table.list,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,nullptr,nullptr,1,thread,true,true);
      require(!ledger.claim(table.list,1,thread));passed("full-original-capacity-is-refused");
      ledger.deleted(table.list,1,thread,true,&DeleteProcThreadAttributeList);table.list=nullptr;
    }
    {
      ShellAttributeLedger ledger;ModelTable table(2);HANDLE job=CreateJobObjectW(nullptr,nullptr);require(job!=nullptr);
      auto record=ledger.initialized(table.list,2,0,1,thread,true,true);require(bool(record));
      require(UpdateProcThreadAttribute(table.list,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,&job,sizeof(job),nullptr,nullptr)!=FALSE);
      ledger.updated(table.list,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,nullptr,nullptr,1,thread,true,true);
      require(!ledger.claim(table.list,1,thread));passed("original-JOB_LIST-is-preserved-and-refused");
      ledger.deleted(table.list,1,thread,true,&DeleteProcThreadAttributeList);table.list=nullptr;CloseHandle(job);
    }
    for(const auto& test:{std::string("failed-update"),std::string("foreign-update"),std::string("cross-generation-update"),std::string("cross-thread-update")}){
      ShellAttributeLedger ledger;ModelTable table(2);auto record=ledger.initialized(table.list,2,0,1,thread,true,true);require(bool(record));
      ledger.updated(table.list,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,nullptr,nullptr,test=="cross-generation-update"?2:1,test=="cross-thread-update"?thread+1:thread,test!="foreign-update",test!="failed-update");
      require(!ledger.claim(table.list,1,thread));passed(test.c_str());ledger.deleted(table.list,1,thread,true,&DeleteProcThreadAttributeList);table.list=nullptr;
    }
    {
      ShellAttributeLedger ledger;ModelTable table(8);DWORD privateValue=1;
      auto record=ledger.initialized(table.list,8,0,1,thread,true,true);require(bool(record));
      require(UpdateProcThreadAttribute(table.list,0,DWORD_PTR(0x60001),&privateValue,sizeof(privateValue),nullptr,nullptr)!=FALSE);
      ledger.updated(table.list,0,DWORD_PTR(0x60001),nullptr,nullptr,1,thread,true,true);
      require(bool(ledger.claim(table.list,1,thread)));HANDLE job=CreateJobObjectW(nullptr,nullptr);require(job!=nullptr);
      require(ledger.append(record,job,&UpdateProcThreadAttribute));CloseHandle(job);
      require(privateValue==1 && record->keys.size()==2);passed("private-Shell-attribute-is-kept-verbatim");
      require(!ledger.claim(table.list,1,thread));passed("claimed-table-cannot-create-a-second-child");
      modelExpectedJob=&record->job;modelJobLiveAtDelete=false;
      ledger.deleted(table.list,1,thread,true,&modelDeleteCheck);table.list=nullptr;
      require(modelJobLiveAtDelete);passed("Job-array-and-duplicated-handle-live-through-original-Delete");modelExpectedJob=nullptr;
    }
    {
      ShellAttributeLedger ledger;ModelTable table(2);auto record=ledger.initialized(table.list,2,0,1,thread,true,true);require(bool(record));
      require(bool(ledger.claim(table.list,1,thread)));HANDLE job=CreateJobObjectW(nullptr,nullptr);require(job!=nullptr);
      require(!ledger.append(record,job,&modelUpdateFailure));require(GetLastError()==ERROR_ACCESS_DENIED);CloseHandle(job);
      require(!ledger.claim(table.list,1,thread));ledger.cancel({record});
      passed("public-append-failure-keeps-precise-Job-and-refuses-creation");
      ledger.deleted(table.list,1,thread,true,&DeleteProcThreadAttributeList);table.list=nullptr;
    }
    {
      ShellAttributeLedger ledger;ModelTable table(2);auto record=ledger.initialized(table.list,2,0,1,thread,true,true);require(bool(record));
      require(bool(ledger.claim(table.list,1,thread)));HANDLE job=CreateJobObjectW(nullptr,nullptr);require(job!=nullptr);require(ledger.append(record,job,&UpdateProcThreadAttribute));CloseHandle(job);
      ledger.cancel({record});JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
      require(QueryInformationJobObject(record->job,JobObjectBasicAccountingInformation,&accounting,sizeof(accounting),nullptr));
      require(!ledger.claim(table.list,1,thread));passed("missing-Delete-quarantines-stable-storage-and-cleans-only-own-Job");
      ledger.deleted(table.list,1,thread,true,&DeleteProcThreadAttributeList);table.list=nullptr;
    }
    {
      ShellAttributeLedger ledger;ModelTable table(2);auto record=ledger.initialized(table.list,2,0,1,thread,true,true);require(bool(record));
      ShellAttributeLedger::Pointer observed;bool called=false;
      require(!ledger.initialize(table.list,2,0,1,thread,true,observed,[&]{called=true;return TRUE;}));
      require(!called && !ledger.claim(table.list,1,thread));passed("live-reinitialization-never-calls-original-Initialize");
      ledger.deleted(table.list,1,thread,true,&DeleteProcThreadAttributeList);table.list=nullptr;
    }
    {
      ShellAttributeLedger ledger;ModelTable table(2);auto record=ledger.initialized(table.list,2,0,1,thread,true,true);require(bool(record));
      std::thread worker([&]{ledger.deleted(table.list,0,GetCurrentThreadId(),false,&DeleteProcThreadAttributeList);});worker.join();table.list=nullptr;
      require(record->deleted && !record->valid && !ledger.completed({record}));passed("cross-thread-Delete-invalidates-owning-scope");
    }
    {
      ShellAttributeLedger ledger;ModelTable table(2);auto record=ledger.initialized(table.list,2,0,1,thread,true,true);require(bool(record));
      HANDLE entered=CreateEventW(nullptr,TRUE,FALSE,nullptr),release=CreateEventW(nullptr,TRUE,FALSE,nullptr),started=CreateEventW(nullptr,TRUE,FALSE,nullptr),done=CreateEventW(nullptr,TRUE,FALSE,nullptr);
      BOOL updated=FALSE;ShellAttributeLedger::Pointer claimed;DWORD policy=0;
      std::thread updater([&]{updated=ledger.update(table.list,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,nullptr,nullptr,1,thread,true,[&]{
        const BOOL value=UpdateProcThreadAttribute(table.list,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,&policy,sizeof(policy),nullptr,nullptr);
        SetEvent(entered);require(WaitForSingleObject(release,10000)==WAIT_OBJECT_0);return value;});});
      require(WaitForSingleObject(entered,10000)==WAIT_OBJECT_0);
      std::thread contender([&]{SetEvent(started);claimed=ledger.claim(table.list,1,thread);SetEvent(done);});
      require(WaitForSingleObject(started,10000)==WAIT_OBJECT_0 && WaitForSingleObject(done,100)==WAIT_TIMEOUT);
      SetEvent(release);updater.join();contender.join();require(updated && claimed==record);
      bool called=false;require(!ledger.update(table.list,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,nullptr,nullptr,1,thread,true,[&]{called=true;return TRUE;}));require(!called);
      passed("original-Update-and-provenance-are-atomic-with-claim");passed("claimed-Update-never-modifies-the-original-table");
      for(HANDLE event:{entered,release,started,done})CloseHandle(event);ledger.deleted(table.list,1,thread,true,&DeleteProcThreadAttributeList);table.list=nullptr;
    }
    {
      ShellAttributeLedger ledger;SIZE_T size=0;InitializeProcThreadAttributeList(nullptr,2,0,&size);std::vector<unsigned char> storage(size);
      auto list=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
      HANDLE entered=CreateEventW(nullptr,TRUE,FALSE,nullptr),release=CreateEventW(nullptr,TRUE,FALSE,nullptr),started=CreateEventW(nullptr,TRUE,FALSE,nullptr),done=CreateEventW(nullptr,TRUE,FALSE,nullptr);
      BOOL initialized=FALSE;ShellAttributeLedger::Pointer observed,claimed;
      std::thread initializer([&]{initialized=ledger.initialize(list,2,0,1,thread,true,observed,[&]{const BOOL value=InitializeProcThreadAttributeList(list,2,0,&size);SetEvent(entered);require(WaitForSingleObject(release,10000)==WAIT_OBJECT_0);return value;});});
      require(WaitForSingleObject(entered,10000)==WAIT_OBJECT_0);
      std::thread contender([&]{SetEvent(started);claimed=ledger.claim(list,1,thread);SetEvent(done);});
      require(WaitForSingleObject(started,10000)==WAIT_OBJECT_0 && WaitForSingleObject(done,100)==WAIT_TIMEOUT);
      SetEvent(release);initializer.join();contender.join();require(initialized && observed && claimed==observed);
      passed("original-Initialize-and-registration-are-atomic-with-claim");
      for(HANDLE event:{entered,release,started,done})CloseHandle(event);ledger.deleted(list,1,thread,true,&DeleteProcThreadAttributeList);
    }
    std::string cleanup="null";
    {
      wchar_t image[32768]{};require(GetModuleFileNameW(nullptr,image,32768)!=0);
      const auto marker=shellArgument(L"--shell-cleanup-marker=");require(!marker.empty());
      std::wstring command=L"\""+std::wstring(image)+L"\" \"--shell-station="+station+L"\" \"--shell-cleanup-marker="+marker+L"\" --cleanup-child";
      auto desktop=station+L"\\Default";STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.lpDesktop=desktop.data();PROCESS_INFORMATION child{};
      require(CreateProcessW(image,command.data(),nullptr,nullptr,FALSE,CREATE_SUSPENDED|CREATE_NO_WINDOW,nullptr,nullptr,&startup,&child)!=FALSE);
      HANDLE ownJob=CreateJobObjectW(nullptr,nullptr);require(ownJob!=nullptr);BOOL member=TRUE;require(IsProcessInJob(child.hProcess,ownJob,&member) && !member);
      const auto created=processCreation(child.hProcess);require(sakuraTerminateOwnedChild(ownJob,child.hProcess));DWORD code=STILL_ACTIVE;require(GetExitCodeProcess(child.hProcess,&code) && code==1);
      require(GetFileAttributesW(marker.c_str())==INVALID_FILE_ATTRIBUTES);
      cleanup="{\"pid\":"+std::to_string(child.dwProcessId)+",\"created\":\""+std::to_string(created)+"\",\"exactHandle\":true,\"memberOfCleanupJob\":false,\"exitCode\":1,\"applicationCodeAbsent\":true}";
      CloseHandle(child.hThread);CloseHandle(child.hProcess);CloseHandle(ownJob);passed("Job-only-cleanup-falls-back-to-the-owned-exact-child-handle");
    }
    cases+=']';HANDLE pipe=CreateFileW(pipeName.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);require(pipe!=INVALID_HANDLE_VALUE);
    require(shellWrite(pipe,"{\"passed\":true,\"kind\":\"public-attribute-lifecycle-model\",\"station\":"+shellJson(station)+",\"modelCases\":"+cases+",\"count\":"+std::to_string(total)+",\"cleanup\":"+cleanup+"}\n"));
    std::string line;require(shellRead(pipe,line) && line=="exit");CloseHandle(pipe);return 0;
  }catch(const std::exception& error){std::fprintf(stderr,"Shell model: %s\n",error.what());return 90;}
}
