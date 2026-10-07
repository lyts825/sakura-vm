/**
 * 模块职责（中文）：将明确的本地 EXE/open Shell 调用约束到固定策略代次、同线程系统来源和直接注册表关联，原字符串及私有属性保持原样；完成必须对应精确账本孩子，否则取消自身资源。
 * Module responsibilities (English): Constrain explicit local EXE/open Shell calls to pinned policy generation/same-thread system provenance/direct registry association, retaining original strings/private attributes; completion requires the exact ledger child or cancels owned resources.
 */
/** ShellExecute 与进程属性入口的策略拦截，核实直接 EXE 关联和系统调用来源后转入受控后代创建。 */
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
struct ShellReturnError {DWORD value=ERROR_NOT_SUPPORTED;/** 中文：作用域退出恢复所记录的 Win32 LastError，防止核验和清理覆盖原 Shell 结果。 English: Restore recorded Win32 LastError on scope exit so validation/cleanup does not overwrite the original Shell result. */ ~ShellReturnError(){SetLastError(value);}};

/** 中文：大小写不敏感地比较完整宽字符串，供路径、verb 和注册表固定值匹配。 English: Compare complete wide strings case-insensitively for paths, verbs and fixed registry values. 参数声明 / Declared parameters: const std::wstring& first,const std::wstring& second. */
static bool shellSame(const std::wstring& first,const std::wstring& second) {
  return CompareStringOrdinal(first.c_str(),-1,second.c_str(),-1,TRUE)==CSTR_EQUAL;
}
/** 中文：从返回地址定位模块，仅信任系统目录 shell32/windows.storage 的精确路径，核验过程保持 LastError。 English: Resolve a module from the return address and trust only exact system-directory shell32/windows.storage paths while preserving LastError. 参数声明 / Declared parameters: void* address. */
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
/** 中文：分块安全读取调用者字符串至有界终止符，用 ReadProcessMemory 防止不可读页或地址溢出导致本进程崩溃。 English: Safely read caller text in bounded chunks to a terminator, using ReadProcessMemory to avoid crashes from unreadable pages/address overflow. 参数声明 / Declared parameters: const Character* input,std::basic_string<Character>& output. */
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
/** 中文：安全取得宽字符或按 ACP 解码的 ANSI 参数，保留原调用指针，由共享有界读取器拒绝无终止符或不可读内存。 English: Safely obtain wide/ACP-decoded ANSI arguments while retaining original call pointers; the bounded reader rejects unterminated/unreadable memory. 参数声明 / Declared parameters: const wchar_t* input. */
static std::wstring shellRead(const wchar_t* input) {
  std::wstring result;if(!shellText(input,result))throw std::runtime_error("Shell string is not readable");return result;
}
/** 中文：安全取得宽字符或按 ACP 解码的 ANSI 参数，保留原调用指针，由共享有界读取器拒绝无终止符或不可读内存。 English: Safely obtain wide/ACP-decoded ANSI arguments while retaining original call pointers; the bounded reader rejects unterminated/unreadable memory. 参数声明 / Declared parameters: const char* input. */
static std::wstring shellRead(const char* input) {
  std::string value;if(!shellText(input,value))throw std::runtime_error("Shell string is not readable");return descendantWide(value.c_str());
}
struct ShellRegistryKey {
  HKEY value=nullptr;
  /** 中文：关闭成功打开的注册表句柄，正常或异常展开均不泄漏。 English: Close an opened registry key on normal return or exception unwinding. */
  ~ShellRegistryKey(){if(value)RegCloseKey(value);}
  /** 中文：以查询/枚举权限打开指定注册表视图，仅不存在视为缺失，其他错误拒绝关联路径。 English: Open the requested registry view with query/enumeration rights; only absence means missing, while other errors reject the association path. 参数声明 / Declared parameters: HKEY root,const std::wstring& name,REGSAM view=0. */
  ShellRegistryKey(HKEY root,const std::wstring& name,REGSAM view=0) {
    const LSTATUS result=RegOpenKeyExW(root,name.c_str(),0,KEY_QUERY_VALUE|KEY_ENUMERATE_SUB_KEYS|view,&value);
    if(result!=ERROR_SUCCESS && result!=ERROR_FILE_NOT_FOUND)throw std::runtime_error("Shell registration cannot be verified");
  }
};
/** 中文：读取有界且单一终止的 REG_SZ 固定关联值，不展开环境或接受嵌入 NUL；缺失与读取失败明确区分。 English: Read bounded single-terminated REG_SZ association values without expansion/embedded NULs, distinguishing absence from read failure. 参数声明 / Declared parameters: HKEY key,const wchar_t* name,std::wstring* text=nullptr. */
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
/** 中文：要求危险重定向注册表键不存在，存在或不可核验即拒绝。 English: Require a dangerous redirection key to be absent, refusing existing or unverifiable keys. 参数声明 / Declared parameters: HKEY root,const std::wstring& name,REGSAM view=0. */
static void shellNoKey(HKEY root,const std::wstring& name,REGSAM view=0) {
  ShellRegistryKey key(root,name,view);if(key.value)throw std::runtime_error("Shell delegation is unsupported");
}
/** 中文：核对两种注册表视图的直接 .exe/open 关联，拒绝委托执行、DDE、UserChoice、兼容层、IFEO 和其他会改写启动来源的扩展。 English: Verify direct .exe/open associations in both registry views and refuse delegation, DDE, UserChoice, compatibility layers, IFEO and other extensions that alter launch provenance. 参数声明 / Declared parameters: const std::wstring& image. */
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
  /** 中文：固定当前策略代次、线程和本地 EXE，拒绝不明确的 verb、私有重定向、模拟身份或提升激活上下文，再建立线程局部显式 Shell 作用域。 English: Pin current policy generation/thread/local EXE, refuse ambiguous verbs/private redirection/impersonation/elevating activation context and establish an explicit thread-local Shell scope. 参数声明 / Declared parameters: const std::wstring& file,const std::wstring& verb. */
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
  /** 中文：要求当前规则仍活动且 seqlock 序列与进入 Shell 时一致，避免中途策略变化被旧授权覆盖。 English: Require active current policy and the same seqlock sequence captured at Shell entry so changed rules cannot reuse old authorization. */
  bool sourceValid() const {return shared && current().active && sequence==InterlockedCompareExchange(&shared->sequence,0,0);}
  /** 中文：比较实际创建进程映像与固定 EXE 完整路径，只允许同一受控目标。 English: Compare actual child image with the pinned EXE's full path to allow only the same controlled target. 参数声明 / Declared parameters: HANDLE child. */
  bool matches(HANDLE child) const {
    std::wstring actual(32768,L'\0');DWORD size=DWORD(actual.size());
    if(!QueryFullProcessImageNameW(child,0,actual.data(),&size))return false;
    actual.resize(size);return shellSame(path,actual);
  }
  /** 中文：未确认成功时取消所属账本并清理精确自有孩子，随后清除线程局部作用域且保持 LastError。 English: On unaccepted completion cancel the owning ledger/clean exact owned children, then clear thread-local scope while preserving LastError. */
  ~ShellPolicyScope(){const DWORD saved=GetLastError();if(!accepted)shellAttributes.cancel(records);shellScope=nullptr;SetLastError(saved);}
};
/** 中文：观察公开属性初始化的可信返回地址与当前作用域，原系统重入直接委托；登记与原调用在同一账本锁内完成。 English: Observe public attribute initialization with trusted return address/current scope, delegate internal system reentry and register atomically with the original call under the ledger lock. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD count,DWORD flags,PSIZE_T size. */
static BOOL WINAPI shellInitialize(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD count,DWORD flags,PSIZE_T size) {
  if(descendantSystemDepth)return originalShellInitialize(list,count,flags,size);
  const auto scope=shellScope;ShellAttributeLedger::Pointer record;
  const BOOL result=shellAttributes.initialize(list,count,flags,scope?scope->generation:0,GetCurrentThreadId(),shellTrustedCaller(__builtin_return_address(0)),record,
    [&]{return originalShellInitialize(list,count,flags,size);});const DWORD error=GetLastError();
  try{if(record && scope)scope->records.push_back(record);}catch(...){shellAttributes.refuseMutation(list,true);}
  SetLastError(error);return result;
}
/** 中文：原系统重入委托，其余更新绑定当前作用域、线程、可信来源和实际结果，保持原属性值指针及 LastError。 English: Delegate internal reentry; bind other updates to current scope/thread/trusted origin/actual result while retaining attribute-value pointers and LastError. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key,PVOID value,SIZE_T size,PVOID previous,PSIZE_T returned. */
static BOOL WINAPI shellUpdate(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR key,PVOID value,SIZE_T size,PVOID previous,PSIZE_T returned) {
  if(descendantSystemDepth)return originalShellUpdate(list,flags,key,value,size,previous,returned);
  const auto scope=shellScope;
  return shellAttributes.update(list,flags,key,previous,returned,scope?scope->generation:0,GetCurrentThreadId(),shellTrustedCaller(__builtin_return_address(0)),
    [&]{return originalShellUpdate(list,flags,key,value,size,previous,returned);});
}
/** 中文：观察真实公开 Delete 并结束该指针代次，内部系统重入直接委托，避免把已删除/重用地址当可信列表。 English: Observe actual public Delete to end a pointer generation, delegating internal reentry and preventing deleted/reused addresses from remaining trusted. 参数声明 / Declared parameters: LPPROC_THREAD_ATTRIBUTE_LIST list. */
static VOID WINAPI shellDelete(LPPROC_THREAD_ATTRIBUTE_LIST list) {
  if(descendantSystemDepth){originalShellDelete(list);return;}
  const auto scope=shellScope;shellAttributes.deleted(list,scope?scope->generation:0,GetCurrentThreadId(),shellTrustedCaller(__builtin_return_address(0)),originalShellDelete);const DWORD error=GetLastError();
  SetLastError(error);
}
/** 中文：清空输出进程句柄并设置 Shell 访问拒绝结果及 Win32 错误，统一失败 ABI。 English: Clear the output process handle and set Shell access-denied/Win32 error results consistently with its failure ABI. 参数声明 / Declared parameters: Info* input,DWORD error=ERROR_NOT_SUPPORTED. */
template<class Info>static BOOL shellRefuse(Info* input,DWORD error=ERROR_NOT_SUPPORTED) {
  if(input){input->hInstApp=reinterpret_cast<HINSTANCE>(INT_PTR(SE_ERR_ACCESSDENIED));input->hProcess=nullptr;}
  SetLastError(error);return FALSE;
}
/** 中文：安全读取并校验扩展参数、明确同步标志和同目标可信重入；原调用成功还须账本恰好提交并删除同线程孩子且返回句柄身份一致，否则取消作用域。 English: Safely validate extended arguments/explicit synchronous flags/same-target trusted reentry; success additionally requires exactly one committed/deleted same-thread child and matching returned handle identity, otherwise cancel the scope. 参数声明 / Declared parameters: Info* input,Call call,void* caller. */
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
/** 中文：保留宽字符 SHELLEXECUTEINFO 原参数，并将直接调用者地址传入共享来源核验。 English: Retain original wide SHELLEXECUTEINFO arguments and pass the direct caller address to shared provenance validation. 参数声明 / Declared parameters: SHELLEXECUTEINFOW* input. */
static BOOL WINAPI shellExecuteExW(SHELLEXECUTEINFOW* input) {
  return shellExecuteExtended(input,[&]{return originalShellExW(input);},__builtin_return_address(0));
}
/** 中文：保留 ANSI SHELLEXECUTEINFO 原指针与编码语义，复用同步和来源核验。 English: Retain original ANSI SHELLEXECUTEINFO pointers/encoding semantics while sharing synchronous/provenance validation. 参数声明 / Declared parameters: SHELLEXECUTEINFOA* input. */
static BOOL WINAPI shellExecuteExA(SHELLEXECUTEINFOA* input) {
  return shellExecuteExtended(input,[&]{return originalShellExA(input);},__builtin_return_address(0));
}
/** 中文：校验本地直接 open 及 show 参数，以精确账本验收原 ShellExecute 成功；异常返回 SE_ERR_ACCESSDENIED 并取消自有资源。 English: Validate direct local open/show arguments and require exact ledger completion for successful ShellExecute; exceptions return SE_ERR_ACCESSDENIED and cancel owned resources. 参数声明 / Declared parameters: const Character* verb,const Character* file, const Character* parameters,const Character* directory,int show,Call call,void* caller. */
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
/** 中文：按原宽字符参数调用 ShellExecuteW，并捕获调用者地址用于可信嵌套核验。 English: Call ShellExecuteW with original wide arguments and capture caller address for trusted nested validation. 参数声明 / Declared parameters: HWND window,LPCWSTR verb,LPCWSTR file,LPCWSTR parameters,LPCWSTR directory,int show. */
static HINSTANCE WINAPI shellExecuteW(HWND window,LPCWSTR verb,LPCWSTR file,LPCWSTR parameters,LPCWSTR directory,int show) {
  return shellExecuteSimple(verb,file,parameters,directory,show,[&]{return originalShellW(window,verb,file,parameters,directory,show);},__builtin_return_address(0));
}
/** 中文：按原 ANSI 参数调用 ShellExecuteA，在共用核验中读取但不替换调用者字符串。 English: Call ShellExecuteA with original ANSI arguments, reading but not replacing caller strings during shared validation. 参数声明 / Declared parameters: HWND window,LPCSTR verb,LPCSTR file,LPCSTR parameters,LPCSTR directory,int show. */
static HINSTANCE WINAPI shellExecuteA(HWND window,LPCSTR verb,LPCSTR file,LPCSTR parameters,LPCSTR directory,int show) {
  return shellExecuteSimple(verb,file,parameters,directory,show,[&]{return originalShellA(window,verb,file,parameters,directory,show);},__builtin_return_address(0));
}
