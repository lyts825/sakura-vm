/**
 * 模块职责（中文）：私有 station 上真实 Win32/OLE 夹具提供读写、延迟渲染、缓存、格式枚举和畸形文本场景，以双向命令通道驱动 GUI 线程并保持数据/COM 所有权。
 * Module responsibilities (English): Real Win32/OLE fixtures on private stations provide read/write/delayed/cached/enumerated/malformed-text scenarios, driving the GUI thread through duplex commands while retaining data/COM ownership rules.
 */
/** 私有 window station 上的真实 Win32/OLE 读写夹具，以命令通道驱动策略验证并隔离用户交互桌面。 */
// Actual Win32/OLE test processes share a private window station. They never
// open or overwrite the user's interactive desktop clipboard.
#include "protocol.h"
#include <ole2.h>
#include <shlobj.h>
#include <sddl.h>
#include <tlhelp32.h>
#include <algorithm>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>
#include <vector>
#include <io.h>
#include <fcntl.h>

static HWND window=nullptr;
static IDataObject* cached=nullptr;
static std::wstring delayed;
static UINT binary=0;
/** 中文：将宽字符夹具文本转换为 UTF-8，供私有 stdout/管道协议使用，空输入保持空输出。 English: Convert wide fixture text to UTF-8 for private stdout/pipe protocols, retaining empty input/output. 参数声明 / Declared parameters: const std::wstring& text. */
static std::string utf8(const std::wstring& text) {
  const int count=WideCharToMultiByte(CP_UTF8,0,text.data(),int(text.size()),nullptr,0,nullptr,nullptr);
  std::string result(count,'\0');
  if (count) WideCharToMultiByte(CP_UTF8,0,text.data(),int(text.size()),result.data(),count,nullptr,nullptr);
  return result;
}
/** 中文：严格解码 UTF-8 命令文本为宽字符，转换失败得到空结果交给具体命令处理。 English: Strictly decode UTF-8 command text to wide characters, leaving an empty result on failed conversion for command handling. 参数声明 / Declared parameters: const std::string& text. */
static std::wstring wide(const std::string& text) {
  const int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),int(text.size()),nullptr,0);
  std::wstring result(count,L'\0');
  if (count) MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),int(text.size()),result.data(),count);
  return result;
}
/** 中文：将宽文本转为 UTF-8 并转义引号、反斜杠与控制字节，输出单个带引号 JSON 值。 English: Convert wide text to UTF-8 and escape quotes/backslashes/control bytes as one quoted JSON value. 参数声明 / Declared parameters: const std::wstring& text. */
static std::string json(const std::wstring& text) {
  std::string result="\"";
  for (const unsigned char c:utf8(text)) {
    if (c=='"'||c=='\\') {result+='\\';result+=char(c);}
    else if (c=='\n') result+="\\n";
    else if (c=='\r') result+="\\r";
    else if (c=='\t') result+="\\t";
    else if(c<32) {constexpr char hex[]="0123456789abcdef";result+="\\u00";result+=hex[c>>4];result+=hex[c&15];}
    else result+=char(c);
  }
  return result+'"';
}
/** 中文：分配可移动 HGLOBAL 并复制含末尾 NUL 的 UTF-16 文本，锁定失败释放；成功返回由后续 medium/剪贴板接管的句柄。 English: Allocate movable HGLOBAL/copy terminated UTF-16 text, freeing on lock failure; return a handle for subsequent medium/clipboard ownership transfer on success. 参数声明 / Declared parameters: const std::wstring& text. */
static HGLOBAL textMemory(const std::wstring& text) {
  const SIZE_T bytes=(text.size()+1)*sizeof(wchar_t);
  HGLOBAL memory=GlobalAlloc(GMEM_MOVEABLE,bytes);
  if (!memory) return nullptr;
  void* contents=GlobalLock(memory);
  if (!contents) {GlobalFree(memory);return nullptr;}
  std::memcpy(contents,text.c_str(),bytes);
  GlobalUnlock(memory);return memory;
}
/** 中文：把成功标志、Win32/HRESULT 数值及文本写为一行 JSON 并 flush，供私有控制方逐条读取。 English: Write/flush one JSON line with success, Win32/HRESULT value and text for private command-by-command reading. 参数声明 / Declared parameters: bool ok,DWORD error=0,const std::wstring& text=L"". */
static void result(bool ok,DWORD error=0,const std::wstring& text=L"") {
  std::cout<<"{\"ok\":"<<(ok?"true":"false")<<",\"error\":"<<error<<",\"text\":"<<json(text)<<'}'<<std::endl;
}
class TextData final:public IDataObject {
  LONG references=1;
  std::wstring text;
  bool rich;
public:
  /** 中文：持有独立文本与是否暴露备用二进制格式标志，作为真实 OLE 延迟源。 English: Retain independent text and an alternate-binary-format flag as a real delayed OLE source. 参数声明 / Declared parameters: std::wstring value,bool other=false. */
  explicit TextData(std::wstring value,bool other=false):text(std::move(value)),rich(other) {}
  /** 中文：只提供声明的 IUnknown/本类 COM 接口，清空输出并在成功时 AddRef；空输出或未知 IID 返回对应 HRESULT。 English: Expose only declared IUnknown/class COM interfaces, clear output and AddRef on success; null output/unknown IID return corresponding HRESULTs. 参数声明 / Declared parameters: REFIID id,void** out. */
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
    if (!out) return E_POINTER;
    *out=nullptr;
    if (id!=IID_IUnknown && id!=IID_IDataObject) return E_NOINTERFACE;
    *out=static_cast<IDataObject*>(this);AddRef();return S_OK;
  }
  /** 中文：原子增加包装对象 COM 引用计数并返回新计数，调用者需与 Release 配对。 English: Atomically increase the wrapper's COM reference count and return it, requiring caller pairing with Release. */
  ULONG STDMETHODCALLTYPE AddRef() override {return ULONG(InterlockedIncrement(&references));}
  /** 中文：原子减少 COM 引用计数，归零即 delete 当前对象并返回剩余计数。 English: Atomically decrease COM references, delete this object at zero and return the remaining count. */
  ULONG STDMETHODCALLTYPE Release() override {const LONG next=InterlockedDecrement(&references);if(!next)delete this;return ULONG(next);}
  /** 中文：核验格式能力后分配新的文本 HGLOBAL，清空输出 medium 并把成功对象所有权交付消费者，内存失败返回 HRESULT。 English: Validate capabilities then allocate fresh text HGLOBAL, clear output medium and transfer successful ownership to the consumer, reporting allocation failure via HRESULT. 参数声明 / Declared parameters: FORMATETC* format,STGMEDIUM* out. */
  HRESULT STDMETHODCALLTYPE GetData(FORMATETC* format,STGMEDIUM* out) override {
    if (!format || !out) return E_POINTER;
    *out={};
    const auto answer=QueryGetData(format);
    if (FAILED(answer)) return answer;
    out->hGlobal=textMemory(text); out->tymed=TYMED_HGLOBAL;return out->hGlobal?S_OK:E_OUTOFMEMORY;
  }
  /** 中文：核验格式及调用者 HGLOBAL 容量后复制文本，拒绝自定义释放者，不接管调用者已有存储。 English: Validate format/caller HGLOBAL capacity then copy text, reject custom releasers and retain caller ownership of existing storage. 参数声明 / Declared parameters: FORMATETC* format,STGMEDIUM* out. */
  HRESULT STDMETHODCALLTYPE GetDataHere(FORMATETC* format,STGMEDIUM* out) override {
    if(!format || !out)return E_POINTER;
    const HRESULT answer=QueryGetData(format);
    if(FAILED(answer))return answer;
    if(out->tymed!=TYMED_HGLOBAL || out->pUnkForRelease)return DV_E_TYMED;
    const SIZE_T length=(text.size()+1)*sizeof(wchar_t);
    if(GlobalSize(out->hGlobal)<length)return STG_E_MEDIUMFULL;
    void* bytes=GlobalLock(out->hGlobal);
    if(!bytes)return E_OUTOFMEMORY;
    std::memcpy(bytes,text.c_str(),length);GlobalUnlock(out->hGlobal);return S_OK;
  }
  /** 中文：只声明内容 aspect 的 Unicode 或启用的备用格式及 HGLOBAL 位，其他组合返回 DV_E_FORMATETC。 English: Advertise only content-aspect Unicode/optional alternate format with HGLOBAL bits and return DV_E_FORMATETC otherwise. 参数声明 / Declared parameters: FORMATETC* format. */
  HRESULT STDMETHODCALLTYPE QueryGetData(FORMATETC* format) override {
    return format && (format->cfFormat==CF_UNICODETEXT || (rich && format->cfFormat==binary)) && (format->tymed&TYMED_HGLOBAL) && format->dwAspect==DVASPECT_CONTENT ? S_OK:DV_E_FORMATETC;
  }
  /** 中文：报告原格式即标准格式并清除目标设备输出指针，不分配额外格式对象。 English: Report that the original format is canonical and clear the output target-device pointer without allocating extra format objects. 参数声明 / Declared parameters: FORMATETC*,FORMATETC* out. */
  HRESULT STDMETHODCALLTYPE GetCanonicalFormatEtc(FORMATETC*,FORMATETC* out) override {if(out)out->ptd=nullptr;return DATA_S_SAMEFORMATETC;}
  /** 中文：只读延迟源不实现写入，返回 E_NOTIMPL 且不接管传入 medium。 English: The read-only delayed source does not implement writes and returns E_NOTIMPL without taking medium ownership. 参数声明 / Declared parameters: FORMATETC*,STGMEDIUM*,BOOL. */
  HRESULT STDMETHODCALLTYPE SetData(FORMATETC*,STGMEDIUM*,BOOL) override {return E_NOTIMPL;}
  /** 中文：仅枚举读取方向的 Unicode 及可选备用 HGLOBAL 格式，调用标准系统枚举器构造 API。 English: Enumerate only read-direction Unicode/optional alternate HGLOBAL formats using the standard system enumerator constructor. 参数声明 / Declared parameters: DWORD direction,IEnumFORMATETC** out. */
  HRESULT STDMETHODCALLTYPE EnumFormatEtc(DWORD direction,IEnumFORMATETC** out) override {
    if (direction!=DATADIR_GET) return E_NOTIMPL;
    FORMATETC formats[2]{{CF_UNICODETEXT,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL},{CLIPFORMAT(binary),nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL}};
    return SHCreateStdEnumFmtEtc(rich?2:1,formats,out);
  }
  /** 中文：此自有 TextData 不支持通知订阅，返回 OLE_E_ADVISENOTSUPPORTED。 English: Owned TextData does not support advisory subscriptions and returns OLE_E_ADVISENOTSUPPORTED. 参数声明 / Declared parameters: FORMATETC*,DWORD,IAdviseSink*,DWORD*. */
  HRESULT STDMETHODCALLTYPE DAdvise(FORMATETC*,DWORD,IAdviseSink*,DWORD*) override {return OLE_E_ADVISENOTSUPPORTED;}
  /** 中文：此自有 TextData 无通知连接，取消请求返回 OLE_E_ADVISENOTSUPPORTED。 English: Owned TextData has no advisory connections and returns OLE_E_ADVISENOTSUPPORTED for cancellation. 参数声明 / Declared parameters: DWORD. */
  HRESULT STDMETHODCALLTYPE DUnadvise(DWORD) override {return OLE_E_ADVISENOTSUPPORTED;}
  /** 中文：此自有 TextData 不提供通知枚举，返回 OLE_E_ADVISENOTSUPPORTED。 English: Owned TextData provides no advisory enumeration and returns OLE_E_ADVISENOTSUPPORTED. 参数声明 / Declared parameters: IEnumSTATDATA**. */
  HRESULT STDMETHODCALLTYPE EnumDAdvise(IEnumSTATDATA**) override {return OLE_E_ADVISENOTSUPPORTED;}
};
/** 中文：按指定文本/备用格式读取 GetData 或 caller-buffer GetDataHere，转换结果为 JSON并释放 medium；失败释放自身预分配缓冲。 English: Read text/alternate format through GetData or caller-buffer GetDataHere, emit JSON and release the medium, freeing preallocated caller storage on failure. 参数声明 / Declared parameters: IDataObject* data,bool here=false,bool other=false. */
static void readOle(IDataObject* data,bool here=false,bool other=false) {
  if (!data) {result(false);return;}
  FORMATETC format{CLIPFORMAT(other?binary:CF_UNICODETEXT),nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL}; STGMEDIUM medium{};
  if(here){medium.tymed=TYMED_HGLOBAL;medium.hGlobal=GlobalAlloc(GMEM_MOVEABLE|GMEM_ZEROINIT,4096);}
  const HRESULT answer=here?data->GetDataHere(&format,&medium):data->GetData(&format,&medium);
  if (FAILED(answer)) {if(here && medium.hGlobal)GlobalFree(medium.hGlobal);result(false,DWORD(answer));return;}
  const auto contents=static_cast<const wchar_t*>(GlobalLock(medium.hGlobal));
  const std::wstring text=contents?contents:L"";
  if(contents)GlobalUnlock(medium.hGlobal);
  ReleaseStgMedium(&medium);result(contents!=nullptr,0,text);
}
/** 中文：分派私有 Win32/OLE 读写、缓存、枚举、延迟渲染及畸形内容场景，每个分支平衡剪贴板锁及数据所有权。 English: Dispatch private Win32/OLE read/write/cache/enumeration/delayed-render/malformed-data scenarios with balanced clipboard locks/data ownership per branch. 参数声明 / Declared parameters: const std::string& line. */
static void command(const std::string& line) {
  const auto split=line.find('\t');
  const auto action=line.substr(0,split);
  const auto text=split==std::string::npos?L"":wide(line.substr(split+1));
  if(action=="exit") {PostQuitMessage(0);return;}
  if(action=="libraries") {
    HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPMODULE,GetCurrentProcessId());
    if(snapshot==INVALID_HANDLE_VALUE){result(false,GetLastError());return;}
    MODULEENTRY32W module{};module.dwSize=sizeof(module);unsigned count=0;
    if(Module32FirstW(snapshot,&module))do{
      if(CompareStringOrdinal(module.szModule,-1,sizeof(void*)==4?L"SakuraClipboardPolicy-x86.dll":L"SakuraClipboardPolicy.dll",-1,TRUE)==CSTR_EQUAL)++count;
    }while(Module32NextW(snapshot,&module));
    CloseHandle(snapshot);std::cout<<"{\"count\":"<<count<<'}'<<std::endl;return;
  }
  if(action=="ole-read"||action=="ole-cache"||action=="ole-read-here"||action=="ole-read-binary") {
    IDataObject* data=nullptr;const auto answer=OleGetClipboard(&data);
    if(FAILED(answer)){result(false,DWORD(answer));return;}
    if(action=="ole-cache"){if(cached)cached->Release();cached=data;result(true);}
    else{readOle(data,action=="ole-read-here",action=="ole-read-binary");data->Release();}return;
  }
  if(action=="ole-cached-read"){readOle(cached);return;}
  if(action=="ole-copy"||action=="ole-copy-rich") {
    auto source=new TextData(text,action=="ole-copy-rich"); const auto answer=OleSetClipboard(source);source->Release();
    result(SUCCEEDED(answer),DWORD(answer));return;
  }
  if(action=="ole-flush"){const auto answer=OleFlushClipboard();result(SUCCEEDED(answer),DWORD(answer));return;}
  if(!OpenClipboard(window)){result(false,GetLastError());return;}
  if(action=="read"||action=="read-binary") {
    const HANDLE data=GetClipboardData(action=="read"?CF_UNICODETEXT:binary);
    const DWORD error=GetLastError();
    if (!data) {CloseClipboard();result(false,error);return;}
    const void* contents=GlobalLock(data);
    const std::wstring got=contents ? (action=="read"?static_cast<const wchar_t*>(contents):L"binary") : L"";
    if(contents)GlobalUnlock(data);CloseClipboard();result(contents!=nullptr,0,got);return;
  }
  if(action=="formats") {
    UINT next=0,count=0;std::string names="[";
    while((next=EnumClipboardFormats(next))!=0){
      wchar_t name[256]{};GetClipboardFormatNameW(next,name,256);
      if(count++)names+=',';names+=json(name);
    }
    names+=']';
    UINT items[64]{};UINT filled=0;const BOOL update=GetUpdatedClipboardFormats(items,64,&filled);
    UINT priority[2]{CF_UNICODETEXT,binary};
    std::cout<<"{\"count\":"<<count<<",\"nativeCount\":"<<CountClipboardFormats()<<",\"available\":"<<(IsClipboardFormatAvailable(CF_UNICODETEXT)?"true":"false")
      <<",\"priority\":"<<GetPriorityClipboardFormat(priority,2)<<",\"updated\":"<<(update?"true":"false")<<",\"filled\":"<<filled<<",\"names\":"<<names<<'}'<<std::endl;
    CloseClipboard();return;
  }
  if(action=="write"||action=="delayed"||action=="write-binary"||action=="malformed") {
    if(!EmptyClipboard()){const auto error=GetLastError();CloseClipboard();result(false,error);return;}
    if(action=="delayed") {
      delayed=text;SetLastError(0);SetClipboardData(CF_UNICODETEXT,nullptr);const auto error=GetLastError();
      CloseClipboard();result(error==0,error);return;
    }
    HGLOBAL memory=nullptr;UINT format=CF_UNICODETEXT;
    if(action=="write")memory=textMemory(text);
    else {
      const char payload[]="fixture binary";const SIZE_T size=action=="malformed"?1:sizeof(payload);
      memory=GlobalAlloc(GMEM_MOVEABLE,size);void* bytes=GlobalLock(memory);
      if(bytes){std::memcpy(bytes,payload,size);GlobalUnlock(memory);}
      if(action=="write-binary")format=binary;
    }
    const HANDLE accepted=SetClipboardData(format,memory);const DWORD error=GetLastError();
    if(!accepted&&memory)GlobalFree(memory);CloseClipboard();result(accepted!=nullptr,error);return;
  }
  CloseClipboard();result(false,ERROR_INVALID_PARAMETER);
}
/** 中文：仅在请求 Unicode 延迟渲染时提供已保存文本，SetClipboardData 失败回收 HGLOBAL；其他消息交给默认窗口过程。 English: Supply saved text only on Unicode delayed-render requests, free HGLOBAL on SetClipboardData failure and delegate other messages to the default procedure. 参数声明 / Declared parameters: HWND handle,UINT message,WPARAM a,LPARAM b. */
static LRESULT CALLBACK procedure(HWND handle,UINT message,WPARAM a,LPARAM b) {
  if(message==WM_RENDERFORMAT && a==CF_UNICODETEXT) {
    HGLOBAL data=textMemory(delayed);
    if(!SetClipboardData(CF_UNICODETEXT,data))GlobalFree(data);
    return 0;
  }
  return DefWindowProcW(handle,message,a,b);
}
/** 中文：在 Main 入口按 owner/PID/创建时间读取 ABI 与活动就绪快照，用来记录策略是否已覆盖入口，结束关闭映射。 English: At Main entry read ABI/active/readiness by owner/PID/creation time to record preentry protection and close the mapping afterward. 参数声明 / Declared parameters: const wchar_t* owner. */
static bool entryPolicy(const wchar_t* owner) {
  const auto created=processCreation(GetCurrentProcess());
  const std::wstring name=L"Local\\SakuraClipboard."+std::wstring(owner)+L"."+
    std::to_wstring(GetCurrentProcessId())+L"."+std::to_wstring(created);
  const HANDLE section=OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str());
  if (!section)return false;
  const auto policy=static_cast<const SakuraClipboardPolicy*>(MapViewOfFile(section,FILE_MAP_READ,0,0,sizeof(SakuraClipboardPolicy)));
  const bool ready=policy && policy->magic==SakuraClipboardMagic && policy->version==SakuraClipboardVersion &&
    policy->pid==GetCurrentProcessId() && policy->creationTime==created && policy->active==1 && policy->status==1 &&
    !(policy->sequence&1);
  if(policy)UnmapViewOfFile(policy);CloseHandle(section);return ready;
}
/** 中文：分派启动或私有 station 创建/加入，核验控制参数、建立真实 OLE/窗口和消息队列并报告身份；输入线程只投递命令，GUI 线程执行 API 并平衡缓存资源。 English: Dispatch launch/private-station creation/join, validate control arguments, create real OLE/window/message queue and report identity; input threads only post commands while the GUI thread runs APIs/balances cached resources. 参数声明 / Declared parameters: int argc,wchar_t** argv. */
int wmain(int argc,wchar_t** argv) {
  // Capture the policy library at the first statement in application main.
  // This does not claim to sandbox loader/TLS or third-party DLL initialization.
  const bool entryLibrary=GetModuleHandleW(sizeof(void*)==4?L"SakuraClipboardPolicy-x86.dll":L"SakuraClipboardPolicy.dll")!=nullptr;
  const bool controlled=argc>=5 && std::wstring(argv[1])==L"--controlled";
  const bool entryReady=controlled && entryLibrary && entryPolicy(argv[4]);
  std::wstring stationArgument=controlled?argv[3]:(argc==2?argv[1]:L"");
  std::vector<std::wstring> literalArguments;
  if(controlled)for(int index=5;index<argc;++index)literalArguments.emplace_back(argv[index]);
  if(controlled && literalArguments.size()==2 && literalArguments[0]==L"--entry-marker") {
    // Failure-path tests use an owned marker to detect an accidental resume.
    const HANDLE marker=CreateFileW(literalArguments[1].c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(marker!=INVALID_HANDLE_VALUE)CloseHandle(marker);
  }
  if(argc==3 && std::wstring(argv[1])==L"--launch") {
    wchar_t executable[32768]{};
    if(!GetModuleFileNameW(nullptr,executable,32768))return 2;
    std::wstring command=L"\""+std::wstring(executable)+L"\" --create \""+argv[2]+L"\"";
    STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESHOWWINDOW;startup.wShowWindow=SW_HIDE;
    PROCESS_INFORMATION child{};
    wchar_t* environment=GetEnvironmentStringsW();
    // This test-only launch makes a fresh logon identifier without authenticating
    // or creating an account. The fixture performs no network operations.
    const BOOL started=CreateProcessWithLogonW(L"SakuraClipboardFixture",L".",L"unused-test-credentials",
      LOGON_NETCREDENTIALS_ONLY,executable,command.data(),CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT,
      environment,nullptr,&startup,&child);
    const DWORD error=GetLastError();FreeEnvironmentStringsW(environment);
    if(!started){std::cerr<<"CreateProcessWithLogonW "<<error<<std::endl;return 9;}
    CloseHandle(child.hThread);WaitForSingleObject(child.hProcess,INFINITE);
    DWORD code=0;GetExitCodeProcess(child.hProcess,&code);CloseHandle(child.hProcess);
    return int(code);
  }
  if((argc==3 && std::wstring(argv[1])==L"--create") || controlled) {
    HANDLE pipe=CreateFileW(argv[2],GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);
    if(pipe==INVALID_HANDLE_VALUE)return 10;
    const int file=_open_osfhandle(reinterpret_cast<intptr_t>(pipe),_O_RDWR|_O_BINARY);
    // Controlled launches intentionally have no inherited standard handles.
    // Give the CRT valid FILE descriptors before rebinding its private pipe.
    if(file<0 || !std::freopen("NUL","rb",stdin) || !std::freopen("NUL","wb",stdout) ||
        _dup2(file,_fileno(stdin)) || _dup2(file,_fileno(stdout)))return 10;
    _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
    std::cin.clear();std::cout.clear();
    if(!controlled)stationArgument=L"--create";
    argc=2;
  }
  if(argc!=2)return 2;
  HWINSTA station=nullptr;
  if(stationArgument==L"--create") {
    HANDLE token=nullptr;DWORD size=0;
    if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))return 2;
    GetTokenInformation(token,TokenUser,nullptr,0,&size);
    auto contents=new unsigned char[size];
    if(!GetTokenInformation(token,TokenUser,contents,size,&size))return 2;
    wchar_t* sid=nullptr;
    if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(contents)->User.Sid,&sid))return 2;
    const std::wstring text=L"D:P(A;;GA;;;"+std::wstring(sid)+L")(A;;GA;;;SY)";
    LocalFree(sid);delete[] contents;CloseHandle(token);
    PSECURITY_DESCRIPTOR descriptor=nullptr;
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(text.c_str(),SDDL_REVISION_1,&descriptor,nullptr))return 2;
    SECURITY_ATTRIBUTES attributes{sizeof(attributes),descriptor,FALSE};
    // Normal users can request a system-generated station name. CREATE_ONLY
    // makes a pre-existing station a hard failure rather than a shared test surface.
    station=CreateWindowStationW(nullptr,1,WINSTA_ALL_ACCESS,&attributes);
    LocalFree(descriptor);
  } else {
    // Controlled tests may only join the already-created private fixture station.
    if(stationArgument.empty() || CompareStringOrdinal(stationArgument.c_str(),-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)return 3;
    station=OpenWindowStationW(stationArgument.c_str(),FALSE,WINSTA_ALL_ACCESS);
  }
  if(!station){const DWORD error=GetLastError();std::cerr<<"CreateWindowStation "<<error<<std::endl;return 3;}
  if(!SetProcessWindowStation(station)){const DWORD error=GetLastError();std::cerr<<"SetProcessWindowStation "<<error<<std::endl;return 3;}
  HDESK desktop=CreateDesktopW(L"default",nullptr,nullptr,0,GENERIC_ALL,nullptr);
  if(!desktop){std::cerr<<"CreateDesktop "<<GetLastError()<<std::endl;return 4;}
  if(!SetThreadDesktop(desktop)){std::cerr<<"SetThreadDesktop "<<GetLastError()<<std::endl;return 4;}
  if(FAILED(OleInitialize(nullptr)))return 5;
  WNDCLASSW definition{};definition.lpfnWndProc=procedure;definition.lpszClassName=L"SakuraClipboardTestWindow";definition.hInstance=GetModuleHandleW(nullptr);
  if(!RegisterClassW(&definition))return 6;
  window=CreateWindowExW(0,definition.lpszClassName,L"fixture",0,0,0,0,0,HWND_MESSAGE,nullptr,definition.hInstance,nullptr);
  if(!window)return 7;
  binary=RegisterClipboardFormatW(L"Sakura fixture binary");
  MSG message{};PeekMessageW(&message,nullptr,0,0,PM_NOREMOVE);
  const DWORD thread=GetCurrentThreadId();
  wchar_t stationName[256]{};DWORD stationBytes=0;
  if(!GetUserObjectInformationW(station,UOI_NAME,stationName,sizeof(stationName),&stationBytes))return 8;
  std::cout<<"{\"pid\":"<<GetCurrentProcessId()<<",\"created\":\""<<processCreation(GetCurrentProcess())<<"\",\"station\":"<<json(stationName);
  if(controlled) {
    wchar_t directory[32768]{};
    const DWORD directoryLength=GetCurrentDirectoryW(32768,directory);
    if(!directoryLength || directoryLength>=32768)return 12;
    if(!OpenClipboard(window))return 11;
    SetLastError(0);const HANDLE pasted=GetClipboardData(CF_UNICODETEXT);const DWORD pasteError=GetLastError();
    SetLastError(0);const BOOL emptied=EmptyClipboard();const DWORD copyError=GetLastError();CloseClipboard();
    std::cout<<",\"directory\":"<<json(directory)<<",\"entryLibrary\":"<<(entryLibrary?"true":"false")<<",\"entryReady\":"<<(entryReady?"true":"false")
      <<",\"initialCopyBlocked\":"<<(!emptied&&copyError==ERROR_ACCESS_DENIED?"true":"false")
      <<",\"initialPasteBlocked\":"<<(!pasted&&pasteError==ERROR_ACCESS_DENIED?"true":"false")<<",\"argv\":[";
    for(size_t index=0;index<literalArguments.size();++index){if(index)std::cout<<',';std::cout<<json(literalArguments[index]);}
    std::cout<<']';
  }
  std::cout<<'}'<<std::endl;
  HANDLE replied=CreateEventW(nullptr,FALSE,FALSE,nullptr);
  std::thread input(/** 中文：后台输入逐条分配命令并投递 GUI 消息，等待回复事件实现一问一答；投递失败回收命令，EOF 投递退出，避免在非 STA 线程访问 OLE。 English: Background input allocates/posts commands one at a time and waits for reply events; free failed posts, post quit on EOF and avoid OLE access on a non-STA thread. */ [thread,replied](){std::string line;while(std::getline(std::cin,line)){
    auto contents=new std::string(std::move(line));
    if(!PostThreadMessageW(thread,WM_APP,0,reinterpret_cast<LPARAM>(contents))){delete contents;break;}
    // The test pipe is synchronous and duplex. Finish the reply before issuing
    // the next blocking read on the same file object.
    WaitForSingleObject(replied,INFINITE);
  }PostThreadMessageW(thread,WM_QUIT,0,0);});
  while(GetMessageW(&message,nullptr,0,0)>0){
    if(message.message==WM_APP){auto contents=reinterpret_cast<std::string*>(message.lParam);command(*contents);delete contents;SetEvent(replied);}
    else{TranslateMessage(&message);DispatchMessageW(&message);}
  }
  input.detach();
  if(cached)cached->Release();DestroyWindow(window);OleUninitialize();
  return 0;
}
