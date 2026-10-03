#pragma once
#include "shell-provenance.h"
#include <shellapi.h>

static decltype(&ShellExecuteExW) originalShellExW=nullptr;
static decltype(&ShellExecuteExA) originalShellExA=nullptr;
static decltype(&ShellExecuteW) originalShellW=nullptr;
static decltype(&ShellExecuteA) originalShellA=nullptr;
static decltype(&InitializeProcThreadAttributeList) originalShellInitialize=nullptr;
static decltype(&UpdateProcThreadAttribute) originalShellUpdate=nullptr;
static decltype(&DeleteProcThreadAttributeList) originalShellDelete=nullptr;
static ShellAttributeLedger shellAttributes;
alignas(8) static volatile LONG64 shellGeneration=0;
struct ShellPolicyScope;
static thread_local ShellPolicyScope* shellScope=nullptr;
struct ShellReturnError {DWORD value=ERROR_NOT_SUPPORTED;~ShellReturnError(){SetLastError(value);}};

static bool shellSame(const std::wstring& first,const std::wstring& second) {
  return CompareStringOrdinal(first.c_str(),-1,second.c_str(),-1,TRUE)==CSTR_EQUAL;
}
static bool shellTrustedCaller(void* address) {
  const DWORD saved=GetLastError();HMODULE module=nullptr;wchar_t path[32768]{},system[MAX_PATH]{};
  const UINT size=GetSystemDirectoryW(system,MAX_PATH);
  const DWORD length=GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    reinterpret_cast<LPCWSTR>(address),&module)?GetModuleFileNameW(module,path,32768):0;
  bool trusted=false;
  if(size && size<MAX_PATH && length>size+1 && length<32768 && path[size]==L'\\' &&
      CompareStringOrdinal(path,int(size),system,int(size),TRUE)==CSTR_EQUAL)
    trusted=shellSame(path+size+1,L"shell32.dll") || shellSame(path+size+1,L"windows.storage.dll");
  SetLastError(saved);return trusted;
}
template<class Character>static bool shellText(const Character* input,std::basic_string<Character>& output) {
  output.clear();if(!input)return true;
  SYSTEM_INFO system{};GetSystemInfo(&system);
  const size_t page=system.dwPageSize;if(!page || page%sizeof(Character))return false;
  uintptr_t address=uintptr_t(input);
  for(size_t total=0;total<32768;){
    const size_t count=std::min<size_t>({256,(page-address%page)/sizeof(Character),32768-total});
    Character bytes[256]{};SIZE_T read=0;
    if(!count || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<void*>(address),bytes,count*sizeof(Character),&read) || read!=count*sizeof(Character))return false;
    for(size_t index=0;index<count;++index){if(!bytes[index])return true;output+=bytes[index];}
    if(address>UINTPTR_MAX-count*sizeof(Character))return false;
    address+=count*sizeof(Character);total+=count;
  }
  return false;
}
static std::wstring shellRead(const wchar_t* input) {
  std::wstring result;if(!shellText(input,result))throw std::runtime_error("Shell string is not readable");return result;
}
static std::wstring shellRead(const char* input) {
  std::string value;if(!shellText(input,value))throw std::runtime_error("Shell string is not readable");return descendantWide(value.c_str());
}
struct ShellRegistryKey {
  HKEY value=nullptr;
  ~ShellRegistryKey(){if(value)RegCloseKey(value);}
  ShellRegistryKey(HKEY root,const std::wstring& name,REGSAM view=0) {
    const LSTATUS result=RegOpenKeyExW(root,name.c_str(),0,KEY_QUERY_VALUE|KEY_ENUMERATE_SUB_KEYS|view,&value);
    if(result!=ERROR_SUCCESS && result!=ERROR_FILE_NOT_FOUND)throw std::runtime_error("Shell registration cannot be verified");
  }
};
static bool shellRegistryValue(HKEY key,const wchar_t* name,std::wstring* text=nullptr) {
  if(!key)return false;
  DWORD type=0,size=0;
  const LSTATUS result=RegQueryValueExW(key,name,nullptr,&type,nullptr,&size);
  if(result==ERROR_FILE_NOT_FOUND)return false;
  if(result!=ERROR_SUCCESS || size>65536)throw std::runtime_error("Shell registration value cannot be verified");
  if(text){
    if(type!=REG_SZ || size<sizeof(wchar_t) || size%sizeof(wchar_t))throw std::runtime_error("Shell registration is not a literal command");
    std::vector<wchar_t> bytes(size/sizeof(wchar_t));
    if(RegQueryValueExW(key,name,nullptr,&type,reinterpret_cast<BYTE*>(bytes.data()),&size)!=ERROR_SUCCESS || type!=REG_SZ ||
        bytes.back()!=L'\0' || std::find(bytes.begin(),bytes.end()-1,L'\0')!=bytes.end()-1)throw std::runtime_error("Shell registration changed");
    text->assign(bytes.data(),bytes.size()-1);
  }
  return true;
}
static void shellNoKey(HKEY root,const std::wstring& name,REGSAM view=0) {
  ShellRegistryKey key(root,name,view);if(key.value)throw std::runtime_error("Shell delegation is unsupported");
}
static void shellDirectAssociation(const std::wstring& image) {
  std::wstring value;ShellRegistryKey extension(HKEY_CLASSES_ROOT,L".exe"),command(HKEY_CLASSES_ROOT,L"exefile\\shell\\open\\command");
  if(!shellRegistryValue(extension.value,nullptr,&value) || !shellSame(value,L"exefile") ||
      !shellRegistryValue(command.value,nullptr,&value) || value!=L"\"%1\" %*")throw std::runtime_error("Shell EXE association is not a direct open");
  if(shellRegistryValue(command.value,L"IsolatedCommand",&value) && value!=L"\"%1\" %*")throw std::runtime_error("Shell isolated command is unsupported");
  for(const auto& name:{L".exe\\shell\\open",L"exefile\\shell\\open",L"exefile\\shell\\open\\command"}){
    ShellRegistryKey key(HKEY_CLASSES_ROOT,name);
    for(const wchar_t* field:{L"DelegateExecute",L"ExplorerCommandHandler",L"CommandStateHandler",L"HasLUAShield",L"LegacyDisable"})
      if(shellRegistryValue(key.value,field))throw std::runtime_error("Shell delegated open is unsupported");
    shellNoKey(HKEY_CLASSES_ROOT,std::wstring(name)+L"\\ddeexec");
    shellNoKey(HKEY_CLASSES_ROOT,std::wstring(name)+L"\\DropTarget");
  }
  shellNoKey(HKEY_CURRENT_USER,L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.exe\\UserChoice");
  const auto last=image.find_last_of(L"\\/");const auto name=image.substr(last==std::wstring::npos?0:last+1);
  shellNoKey(HKEY_CLASSES_ROOT,L"Applications\\"+name+L"\\shell\\open\\DropTarget");
  shellNoKey(HKEY_CLASSES_ROOT,L"Applications\\"+name+L"\\shell\\open\\ddeexec");
  ShellRegistryKey namedApplication(HKEY_CLASSES_ROOT,L"Applications\\"+name+L"\\shell\\open\\command");
  if(shellRegistryValue(namedApplication.value,L"DelegateExecute"))throw std::runtime_error("Shell application COM delegation is unsupported");
  for(HKEY root:{HKEY_CURRENT_USER,HKEY_LOCAL_MACHINE})for(REGSAM view:{REGSAM(KEY_WOW64_32KEY),REGSAM(KEY_WOW64_64KEY)}){
    ShellRegistryKey hooks(root,L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ShellExecuteHooks",view);
    if(hooks.value){DWORD values=0,children=0;if(RegQueryInfoKeyW(hooks.value,nullptr,nullptr,nullptr,&children,nullptr,nullptr,&values,nullptr,nullptr,nullptr,nullptr)!=ERROR_SUCCESS || values || children)
      throw std::runtime_error("Shell execute hooks are unsupported");}
    ShellRegistryKey layers(root,L"Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers",view);
    if(shellRegistryValue(layers.value,image.c_str()))throw std::runtime_error("Shell compatibility activation is unsupported");
    ShellRegistryKey application(root,L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\"+name,view);
    for(const wchar_t* field:{L"DelegateExecute",L"DropTarget",L"AppUserModelID",L"PackageId"})
      if(shellRegistryValue(application.value,field))throw std::runtime_error("Shell packaged activation is unsupported");
    ShellRegistryKey debugger(root,L"Software\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\"+name,view);
    if(shellRegistryValue(debugger.value,L"Debugger") || shellRegistryValue(debugger.value,L"UseFilter"))throw std::runtime_error("Shell debugger activation is unsupported");
  }
}
struct ShellPolicyScope {
  uint64_t generation=uint64_t(InterlockedIncrement64(&shellGeneration));
  DWORD thread=GetCurrentThreadId();LONG sequence=0;
  DescendantHandle image;
  std::wstring path;
  std::vector<ShellAttributeLedger::Pointer> records;
  bool accepted=false;
  explicit ShellPolicyScope(const std::wstring& file,const std::wstring& verb) {
    if(shellScope || !shellSame(verb,L"open") || file.size()<7 ||
        !((file[0]>=L'A'&&file[0]<=L'Z') || (file[0]>=L'a'&&file[0]<=L'z')) || file[1]!=L':' || file[2]!=L'\\' ||
        !shellSame(file.substr(file.size()-4),L".exe") || file.find_first_of(L"*?\"|<>")!=std::wstring::npos || file.find(L':',2)!=std::wstring::npos)
      throw std::runtime_error("Shell requires an explicit ordinary local EXE open");
    const UINT drive=GetDriveTypeW(file.substr(0,3).c_str());
    if(drive!=DRIVE_FIXED && drive!=DRIVE_REMOVABLE && drive!=DRIVE_RAMDISK)throw std::runtime_error("Shell source is not a local drive");
    DescendantHandle impersonation;
    if(OpenThreadToken(GetCurrentThread(),TOKEN_QUERY,TRUE,&impersonation.value) || GetLastError()!=ERROR_NO_TOKEN)
      throw std::runtime_error("Shell thread impersonation is unsupported");
    image.value=descendantPinCandidate(file,false);if(!image.value)throw std::runtime_error("Shell EXE cannot be pinned");
    path=descendantFilePath(image.value);if(path.empty() || !shellSame(path,file))throw std::runtime_error("Shell EXE path is redirected");
    for(const auto& suffix:{L".manifest",L".local"}){
      const DWORD attributes=GetFileAttributesW((path+suffix).c_str()),error=GetLastError();
      if(attributes!=INVALID_FILE_ATTRIBUTES || (error!=ERROR_FILE_NOT_FOUND && error!=ERROR_PATH_NOT_FOUND))
        throw std::runtime_error("Shell external activation is unsupported or cannot be verified");
    }
    shellDirectAssociation(path);
    // Query Windows' parsed run level without executing the application's
    // imports. Explicit asInvoker prevents installer/UAC broker activation.
    ACTCTXW activation{};activation.cbSize=sizeof(activation);activation.lpSource=path.c_str();
    activation.dwFlags=ACTCTX_FLAG_RESOURCE_NAME_VALID;activation.lpResourceName=MAKEINTRESOURCEW(1);
    const HANDLE context=CreateActCtxW(&activation);if(context==INVALID_HANDLE_VALUE)throw std::runtime_error("Shell run level cannot be verified");
    ACTIVATION_CONTEXT_RUN_LEVEL_INFORMATION level{};SIZE_T size=0;
    const BOOL verified=QueryActCtxW(0,context,nullptr,RunlevelInformationInActivationContext,&level,sizeof(level),&size);
    ReleaseActCtx(context);
    if(!verified || size!=sizeof(level) || level.ulFlags || level.RunLevel!=ACTCTX_RUN_LEVEL_AS_INVOKER || level.UiAccess)
      throw std::runtime_error("Shell elevated or unspecified activation is unsupported");
    sequence=shared?InterlockedCompareExchange(&shared->sequence,0,0):1;
    if(sequence&1 || !current().active)throw std::runtime_error("Shell source policy changed");
    records.reserve(8);shellScope=this;
  }
  bool sourceValid() const {return shared && current().active && sequence==InterlockedCompareExchange(&shared->sequence,0,0);}
  bool matches(HANDLE child) const {
    std::wstring actual(32768,L'\0');DWORD size=DWORD(actual.size());
    if(!QueryFullProcessImageNameW(child,0,actual.data(),&size))return false;
    actual.resize(size);return shellSame(path,actual);
  }
  ~ShellPolicyScope(){const DWORD saved=GetLastError();if(!accepted)shellAttributes.cancel(records);shellScope=nullptr;SetLastError(saved);}
};
static BOOL WINAPI shellInitialize(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD count,DWORD flags,PSIZE_T size) {
  if(descendantSystemDepth)return originalShellInitialize(list,count,flags,size);
  const auto scope=shellScope;ShellAttributeLedger::Pointer record;
  const BOOL result=shellAttributes.initialize(list,count,flags,scope?scope->generation:0,GetCurrentThreadId(),shellTrustedCaller(__builtin_return_address(0)),record,
    [&]{return originalShellInitialize(list,count,flags,size);});const DWORD error=GetLastError();
  try{if(record && scope)scope->records.push_back(record);}catch(...){shellAttributes.refuseMutation(list,true);}
  SetLastError(error);return result;
}
static BOOL WINAPI shellUpdate(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key,PVOID value,SIZE_T size,PVOID previous,PSIZE_T returned) {
  if(descendantSystemDepth)return originalShellUpdate(list,flags,key,value,size,previous,returned);
  const auto scope=shellScope;
  return shellAttributes.update(list,flags,key,previous,returned,scope?scope->generation:0,GetCurrentThreadId(),shellTrustedCaller(__builtin_return_address(0)),
    [&]{return originalShellUpdate(list,flags,key,value,size,previous,returned);});
}
static VOID WINAPI shellDelete(LPPROC_THREAD_ATTRIBUTE_LIST list) {
  if(descendantSystemDepth){originalShellDelete(list);return;}
  const auto scope=shellScope;shellAttributes.deleted(list,scope?scope->generation:0,GetCurrentThreadId(),shellTrustedCaller(__builtin_return_address(0)),originalShellDelete);const DWORD error=GetLastError();
  SetLastError(error);
}
template<class Info>static BOOL shellRefuse(Info* input,DWORD error=ERROR_NOT_SUPPORTED) {
  if(input){input->hInstApp=reinterpret_cast<HINSTANCE>(INT_PTR(SE_ERR_ACCESSDENIED));input->hProcess=nullptr;}
  SetLastError(error);return FALSE;
}
template<class Info,class Call>static BOOL shellExecuteExtended(Info* input,Call call,void* caller) {
  const DWORD incoming=GetLastError();if(!shellScope && !current().active){SetLastError(incoming);return call();}
  ShellReturnError returned;
  Info fields{};SIZE_T copied=0;
  if(!input || !ReadProcessMemory(GetCurrentProcess(),input,&fields,sizeof(fields),&copied) || copied!=sizeof(fields) || fields.cbSize!=sizeof(fields)){
    SetLastError(ERROR_NOT_SUPPORTED);return FALSE;
  }
  try{
    const auto file=shellRead(fields.lpFile),verb=shellRead(fields.lpVerb);
    if(shellScope){
      if(!shellScope->sourceValid() || !shellTrustedCaller(caller) || !shellSame(file,shellScope->path) || !shellSame(verb,L"open"))return shellRefuse(input);
      const BOOL result=call();returned.value=GetLastError();return result;
    }
    constexpr ULONG allowed=SEE_MASK_NOCLOSEPROCESS|SEE_MASK_NOASYNC|SEE_MASK_FLAG_NO_UI|SEE_MASK_NO_CONSOLE|SEE_MASK_WAITFORINPUTIDLE;
    if(!(fields.fMask&SEE_MASK_NOASYNC) || fields.fMask&~allowed || fields.nShow<0 || fields.nShow>SW_MAX)return shellRefuse(input);
    // Validate strings without changing their original pointers or semantics.
    shellRead(fields.lpParameters);shellRead(fields.lpDirectory);
    ShellPolicyScope scope(file,verb);SetLastError(incoming);const BOOL result=call();const DWORD error=GetLastError();
    const auto returnedProcess=input->hProcess;
    bool sameProcess=!(fields.fMask&SEE_MASK_NOCLOSEPROCESS) && !returnedProcess;
    for(const auto& record:scope.records)if(record->child && returnedProcess && GetProcessId(returnedProcess)==GetProcessId(record->child) &&
        processCreation(returnedProcess)==processCreation(record->child))sameProcess=true;
    if(result && (!shellAttributes.completed(scope.records) || !sameProcess)){
      if(returnedProcess && sameProcess)CloseHandle(returnedProcess);
      return shellRefuse(input);
    }
    scope.accepted=result!=FALSE;returned.value=error;return result;
  }catch(...){return shellRefuse(input);}
}
static BOOL WINAPI shellExecuteExW(SHELLEXECUTEINFOW* input) {
  return shellExecuteExtended(input,[&]{return originalShellExW(input);},__builtin_return_address(0));
}
static BOOL WINAPI shellExecuteExA(SHELLEXECUTEINFOA* input) {
  return shellExecuteExtended(input,[&]{return originalShellExA(input);},__builtin_return_address(0));
}
template<class Character,class Call>static HINSTANCE shellExecuteSimple(const Character* verb,const Character* file,
    const Character* parameters,const Character* directory,int show,Call call,void* caller) {
  const DWORD incoming=GetLastError();if(!shellScope && !current().active){SetLastError(incoming);return call();}
  ShellReturnError returned;
  try{
    const auto path=shellRead(file),operation=shellRead(verb);
    if(shellScope){
      if(!shellScope->sourceValid() || !shellTrustedCaller(caller) || !shellSame(path,shellScope->path) || !shellSame(operation,L"open"))throw std::runtime_error("Shell reentry is unsupported");
      const HINSTANCE result=call();returned.value=GetLastError();return result;
    }
    if(show<0 || show>SW_MAX)throw std::runtime_error("Shell show flag is unsupported");
    shellRead(parameters);shellRead(directory);
    ShellPolicyScope scope(path,operation);SetLastError(incoming);const HINSTANCE result=call();const DWORD error=GetLastError();
    if(INT_PTR(result)>32 && !shellAttributes.completed(scope.records))throw std::runtime_error("Shell did not commit the exact same-thread child");
    scope.accepted=INT_PTR(result)>32;returned.value=error;return result;
  }catch(...){SetLastError(ERROR_NOT_SUPPORTED);return reinterpret_cast<HINSTANCE>(INT_PTR(SE_ERR_ACCESSDENIED));}
}
static HINSTANCE WINAPI shellExecuteW(HWND window,LPCWSTR verb,LPCWSTR file,LPCWSTR parameters,LPCWSTR directory,int show) {
  return shellExecuteSimple(verb,file,parameters,directory,show,[&]{return originalShellW(window,verb,file,parameters,directory,show);},__builtin_return_address(0));
}
static HINSTANCE WINAPI shellExecuteA(HWND window,LPCSTR verb,LPCSTR file,LPCSTR parameters,LPCSTR directory,int show) {
  return shellExecuteSimple(verb,file,parameters,directory,show,[&]{return originalShellA(window,verb,file,parameters,directory,show);},__builtin_return_address(0));
}
