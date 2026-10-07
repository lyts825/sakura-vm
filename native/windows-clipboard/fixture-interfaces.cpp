/**
 * 模块职责（中文）：私有环境中的真实 Win32 控件、OLE 及公开 WinRT API 探针，复用普通夹具通信并测试缓存、嵌套创建、键盘和 preflight 失败，所有 GUI/STA 数据操作位于消息线程。
 * Module responsibilities (English): Probe real Win32 controls/OLE/public WinRT APIs in private environments, reusing ordinary fixture communication for cached/nested/keyboard/preflight failures and keeping GUI/STA data operations on the message thread.
 */
/** 复用私有 window station 的常规 API 探针，覆盖 Win32 控件、OLE 及 WinRT 剪贴板接口。 */
// Owned ordinary API probe. Reuse the existing fixture's proven private-station
// launcher, JSON/UTF-8 helpers, Win32/OLE peer operations and clipboard owner.
// No syscall, user desktop, clipboard history or cloud API is used here.
#define wmain standardFixtureMain
#define command standardFixtureCommand
#include "fixture.cpp"
#undef command
#undef wmain
#include <cwchar>
#include <richedit.h>
#include <richole.h>

static HWND editControl=nullptr, richControl=nullptr, editAnsiControl=nullptr, richAnsiControl=nullptr,nestedParent=nullptr;
static IUnknown* winrtClipboard=nullptr;
static IUnknown* winrtCached=nullptr;
using RtString=void*;
/** 中文：保存 RoInitialize 的公开 WinRT ABI，apartment 参数决定线程初始化方式，HRESULT 供启动阶段判断。 English: Retain public RoInitialize ABI whose apartment argument chooses thread initialization and HRESULT controls runtime startup. 参数声明 / Declared parameters: unsigned. */
static HRESULT (WINAPI* rtInitialize)(unsigned)=nullptr;
/** 中文：保存 RoGetActivationFactory ABI，以 HSTRING 类名和 IID 获取带所有权的 factory 输出，HRESULT 表示激活结果。 English: Retain RoGetActivationFactory ABI for an HSTRING class/IID to owned factory output, with HRESULT reporting activation. 参数声明 / Declared parameters: RtString,REFIID,void**. */
static HRESULT (WINAPI* rtFactory)(RtString,REFIID,void**)=nullptr;
/** 中文：保存 RoActivateInstance ABI，以运行时类名创建实例并通过输出指针交付 COM 引用。 English: Retain RoActivateInstance ABI to create a runtime-class instance and deliver its COM reference through output. 参数声明 / Declared parameters: RtString,IUnknown**. */
static HRESULT (WINAPI* rtActivate)(RtString,IUnknown**)=nullptr;
/** 中文：保存 WindowsCreateString ABI，以 UTF-16 指针和显式长度构造 HSTRING，输出成功后必须删除。 English: Retain WindowsCreateString ABI to construct HSTRING from UTF-16 pointer/explicit length, requiring deletion after successful output. 参数声明 / Declared parameters: PCWSTR,UINT32,RtString*. */
static HRESULT (WINAPI* rtCreateString)(PCWSTR,UINT32,RtString*)=nullptr;
/** 中文：保存 WindowsDeleteString ABI，释放夹具创建的 HSTRING 并返回 HRESULT。 English: Retain WindowsDeleteString ABI to release fixture-created HSTRING and report HRESULT. 参数声明 / Declared parameters: RtString. */
static HRESULT (WINAPI* rtDeleteString)(RtString)=nullptr;
/** 中文：保存 WindowsGetStringRawBuffer ABI，返回只读 UTF-16 借用指针及显式长度，有效期依赖原 HSTRING。 English: Retain WindowsGetStringRawBuffer ABI returning borrowed read-only UTF-16 data/explicit length whose lifetime depends on its HSTRING. 参数声明 / Declared parameters: RtString,UINT32*. */
static PCWSTR (WINAPI* rtStringBuffer)(RtString,UINT32*)=nullptr;
static HRESULT winrtInitialization=E_NOTIMPL;

// Public WinRT COM ABI, checked against installed Windows SDK 10.0.26100.0
// windows.applicationmodel.datatransfer.h. Slots include IInspectable's six
// methods; this calls documented interfaces, not an undocumented system API.
/** 中文：按公开 WinRT COM ABI 的固定 vtable 槽取得声明类型函数，调用方负责匹配已验证接口 IID 和槽位。 English: Get a typed function at a fixed public WinRT COM ABI vtable slot; callers match the verified IID/slot. 参数声明 / Declared parameters: IUnknown* object,unsigned index. */
template<class T> static T rtMethod(IUnknown* object,unsigned index) {
  return reinterpret_cast<T>((*reinterpret_cast<void***>(object))[index]);
}
/** 中文：解析固定 WinRT 接口 GUID，编写的常量非法即终止夹具，不能继续用空 IID。 English: Parse a fixed WinRT interface GUID, aborting the fixture for an invalid authored constant instead of continuing with an empty IID. 参数声明 / Declared parameters: PCWSTR text. */
static IID rtId(PCWSTR text) {
  IID result{};if(FAILED(IIDFromString(text,&result)))std::abort();return result;
}
/** 中文：通过动态 WindowsCreateString 创建 HSTRING，API 未就绪或失败返回空，成功调用者配对删除。 English: Create HSTRING through dynamic WindowsCreateString, return null when unavailable/failing and require caller deletion on success. 参数声明 / Declared parameters: const std::wstring& value. */
static RtString rtString(const std::wstring& value) {
  RtString result=nullptr;
  if(!rtCreateString || FAILED(rtCreateString(value.c_str(),UINT32(value.size()),&result)))return nullptr;
  return result;
}
/** 中文：从系统 combase 解析公开运行时 API 并初始化 STA/Clipboard factory，已有 factory 幂等返回，缺少导出或激活失败以 HRESULT 返回。 English: Resolve public APIs from system combase and initialize STA/Clipboard factory, return idempotently for an existing factory and report missing exports/activation failures via HRESULT. */
static HRESULT winrtStart() {
  if(winrtClipboard)return S_OK;
  const HMODULE runtime=LoadLibraryExW(L"combase.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
  if(!runtime)return HRESULT_FROM_WIN32(GetLastError());
  rtInitialize=reinterpret_cast<decltype(rtInitialize)>(GetProcAddress(runtime,"RoInitialize"));
  rtFactory=reinterpret_cast<decltype(rtFactory)>(GetProcAddress(runtime,"RoGetActivationFactory"));
  rtActivate=reinterpret_cast<decltype(rtActivate)>(GetProcAddress(runtime,"RoActivateInstance"));
  rtCreateString=reinterpret_cast<decltype(rtCreateString)>(GetProcAddress(runtime,"WindowsCreateString"));
  rtDeleteString=reinterpret_cast<decltype(rtDeleteString)>(GetProcAddress(runtime,"WindowsDeleteString"));
  rtStringBuffer=reinterpret_cast<decltype(rtStringBuffer)>(GetProcAddress(runtime,"WindowsGetStringRawBuffer"));
  if(!rtInitialize||!rtFactory||!rtActivate||!rtCreateString||!rtDeleteString||!rtStringBuffer)return E_NOTIMPL;
  const HRESULT started=rtInitialize(0);if(FAILED(started))return started;
  const auto name=rtString(L"Windows.ApplicationModel.DataTransfer.Clipboard");
  const HRESULT answer=rtFactory(name,rtId(L"{c627e291-34e2-4963-8eed-93cbb0ea3d70}"),reinterpret_cast<void**>(&winrtClipboard));
  rtDeleteString(name);return answer;
}
/** 中文：构造 DataPackage 并设置文本，再 SetContent/Flush；每个 HSTRING 与 COM 临时引用均释放，失败停止后续步骤。 English: Build a DataPackage/set text then SetContent/Flush, releasing HSTRING/temporary COM references and stopping subsequent steps on failure. 参数声明 / Declared parameters: const std::wstring& text. */
static HRESULT winrtCopy(const std::wstring& text) {
  HRESULT answer=winrtStart();if(FAILED(answer))return answer;
  const auto name=rtString(L"Windows.ApplicationModel.DataTransfer.DataPackage");
  IUnknown* object=nullptr;answer=rtActivate(name,&object);rtDeleteString(name);
  if(FAILED(answer)||!object)return FAILED(answer)?answer:E_POINTER;
  IUnknown* data=nullptr;
  answer=object->QueryInterface(rtId(L"{61ebf5c7-efea-4346-9554-981d7e198ffe}"),reinterpret_cast<void**>(&data));
  object->Release();if(FAILED(answer)||!data)return FAILED(answer)?answer:E_POINTER;
  const auto content=rtString(text);
  answer=rtMethod<HRESULT (STDMETHODCALLTYPE*)(IUnknown*,RtString)>(data,16)(data,content);
  rtDeleteString(content);
  if(SUCCEEDED(answer))answer=rtMethod<HRESULT (STDMETHODCALLTYPE*)(IUnknown*,IUnknown*)>(winrtClipboard,7)(winrtClipboard,data);
  data->Release();
  if(SUCCEEDED(answer))answer=rtMethod<HRESULT (STDMETHODCALLTYPE*)(IUnknown*)>(winrtClipboard,8)(winrtClipboard);
  return answer;
}
/** 中文：清空输出后取得当前 Clipboard 内容视图，先初始化运行时并保留原 HRESULT。 English: Clear output and obtain the current Clipboard view after runtime initialization while retaining the original HRESULT. 参数声明 / Declared parameters: IUnknown** out. */
static HRESULT winrtView(IUnknown** out) {
  *out=nullptr;const HRESULT answer=winrtStart();
  return FAILED(answer)?answer:rtMethod<HRESULT (STDMETHODCALLTYPE*)(IUnknown*,IUnknown**)>(winrtClipboard,6)(winrtClipboard,out);
}
/** 中文：启动 GetTextAsync 后最多等待十秒并泵送 STA 消息，取得文本后释放操作、状态接口及 HSTRING，超时返回 HRESULT。 English: Start GetTextAsync, wait up to ten seconds while pumping STA messages, then release operation/status/HSTRING and report timeout via HRESULT. 参数声明 / Declared parameters: IUnknown* view,std::wstring& text. */
static HRESULT winrtText(IUnknown* view,std::wstring& text) {
  if(!view)return E_POINTER;
  IUnknown* operation=nullptr;
  HRESULT answer=rtMethod<HRESULT (STDMETHODCALLTYPE*)(IUnknown*,IUnknown**)>(view,12)(view,&operation);
  if(FAILED(answer)||!operation)return FAILED(answer)?answer:E_POINTER;
  IUnknown* info=nullptr;
  answer=operation->QueryInterface(rtId(L"{00000036-0000-0000-c000-000000000046}"),reinterpret_cast<void**>(&info));
  if(FAILED(answer)||!info){operation->Release();return FAILED(answer)?answer:E_POINTER;}
  int status=0;const ULONGLONG deadline=GetTickCount64()+10000;
  while(SUCCEEDED(answer)&&status==0&&GetTickCount64()<deadline) {
    answer=rtMethod<HRESULT (STDMETHODCALLTYPE*)(IUnknown*,int*)>(info,7)(info,&status);
    MSG message{};while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){TranslateMessage(&message);DispatchMessageW(&message);}
    if(status==0)Sleep(5);
  }
  if(SUCCEEDED(answer)&&status==0)answer=HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  RtString value=nullptr;
  if(SUCCEEDED(answer))answer=rtMethod<HRESULT (STDMETHODCALLTYPE*)(IUnknown*,RtString*)>(operation,8)(operation,&value);
  if(SUCCEEDED(answer)&&value){UINT32 length=0;const auto bytes=rtStringBuffer(value,&length);text.assign(bytes,length);}
  if(value)rtDeleteString(value);info->Release();operation->Release();return answer;
}
/** 中文：按 edit/rich 与 ANSI/Unicode 场景创建真实多行子控件，保留系统类过程以验证普通复制剪切路径。 English: Create real multiline child controls for edit/rich and ANSI/Unicode scenarios, retaining system procedures to test ordinary copy/cut paths. 参数声明 / Declared parameters: const std::string& kind. */
static HWND makeControl(const std::string& kind) {
  const DWORD style=WS_CHILD|WS_VISIBLE|ES_MULTILINE;
  const HINSTANCE instance=GetModuleHandleW(nullptr);
  if(kind=="editansi")return CreateWindowExA(0,"EDIT","",style,0,100,190,90,window,nullptr,instance,nullptr);
  if(kind=="richansi")return CreateWindowExA(0,"RichEdit20A","",style,200,100,190,90,window,nullptr,instance,nullptr);
  return CreateWindowExW(0,kind=="edit"?L"EDIT":L"RICHEDIT50W",L"",style,kind=="edit"?0:200,0,190,90,window,nullptr,instance,nullptr);
}
struct NestedControl { std::string kind;std::wstring input,after;bool created=false; };
/** 中文：自定义父 WM_CREATE 内创建孩子并立即剪切，验证外层 CreateWindowEx 尚未返回时已保护新控件；其他消息走原编码默认过程。 English: Create/cut a child inside the parent's WM_CREATE to verify protection before outer CreateWindowEx returns; other messages use the encoding-appropriate default procedure. 参数声明 / Declared parameters: HWND parent,UINT message,WPARAM a,LPARAM b. */
static LRESULT CALLBACK nestedControlProcedure(HWND parent,UINT message,WPARAM a,LPARAM b) {
  if(message==WM_CREATE) {
    auto context=static_cast<NestedControl*>(reinterpret_cast<CREATESTRUCTW*>(b)->lpCreateParams);
    const HWND previous=window;window=parent;const HWND child=makeControl(context->kind);window=previous;
    context->created=child!=nullptr;
    if(child) {
      SetWindowTextW(child,context->input.c_str());SendMessageW(child,EM_SETSEL,0,-1);
      // Exercise the new standard child before the custom parent's outer
      // CreateWindowEx returns, rather than after its ordinary message loop.
      SendMessageW(child,WM_CUT,0,0);
      context->after.assign(size_t(GetWindowTextLengthW(child))+1,L'\0');
      GetWindowTextW(child,context->after.data(),int(context->after.size()));
      context->after.resize(std::wcslen(context->after.c_str()));
    }
  }
  return IsWindowUnicode(parent)?DefWindowProcW(parent,message,a,b):DefWindowProcA(parent,message,a,b);
}
class ProbedOleData final:public IDataObject {
  LONG references=1;
  TextData* source;
  std::string mode;
public:
  unsigned reads=0;
  /** 中文：持有 TextData 并记录指定 preflight 故障场景，用于观察 OLE 在清空旧内容前的读取。 English: Retain TextData with the chosen preflight fault mode to observe OLE reads before old clipboard contents are cleared. 参数声明 / Declared parameters: const std::wstring& text,std::string kind. */
  ProbedOleData(const std::wstring& text,std::string kind):source(new TextData(text,true)),mode(std::move(kind)) {}
  /** 中文：释放探针拥有的 TextData 引用，计数生命周期由自身 COM 引用管理。 English: Release probe-owned TextData with the probe lifetime governed by COM reference counting. */
  ~ProbedOleData(){source->Release();}
  /** 中文：只提供声明的 IUnknown/本类 COM 接口，清空输出并在成功时 AddRef；空输出或未知 IID 返回对应 HRESULT。 English: Expose only declared IUnknown/class COM interfaces, clear output and AddRef on success; null output/unknown IID return corresponding HRESULTs. 参数声明 / Declared parameters: REFIID id,void** out. */
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
    if(!out)return E_POINTER;*out=nullptr;if(id!=IID_IUnknown&&id!=IID_IDataObject)return E_NOINTERFACE;
    *out=static_cast<IDataObject*>(this);AddRef();return S_OK;
  }
  /** 中文：原子增加包装对象 COM 引用计数并返回新计数，调用者需与 Release 配对。 English: Atomically increase the wrapper's COM reference count and return it, requiring caller pairing with Release. */
  ULONG STDMETHODCALLTYPE AddRef() override {return ULONG(InterlockedIncrement(&references));}
  /** 中文：原子减少 COM 引用计数，归零即 delete 当前对象并返回剩余计数。 English: Atomically decrease COM references, delete this object at zero and return the remaining count. */
  ULONG STDMETHODCALLTYPE Release() override {const auto next=InterlockedDecrement(&references);if(!next)delete this;return ULONG(next);}
  /** 中文：增加读取计数，可按 changing 场景延迟或 unavailable 返回 E_PENDING，其余委托真实 TextData。 English: Increment read count, delay in changing mode or return E_PENDING for unavailable, otherwise delegate real TextData. 参数声明 / Declared parameters: FORMATETC* format,STGMEDIUM* out. */
  HRESULT STDMETHODCALLTYPE GetData(FORMATETC* format,STGMEDIUM* out) override {
    ++reads;if(mode=="changing")Sleep(1000);
    if(mode=="unavailable"){if(out)*out={};return E_PENDING;}return source->GetData(format,out);
  }
  /** 中文：委托 TextData 向调用者提供的 medium 渲染，保持底层容量及所有权检查。 English: Delegate caller-medium rendering to TextData with its capacity/ownership checks intact. 参数声明 / Declared parameters: FORMATETC* format,STGMEDIUM* out. */
  HRESULT STDMETHODCALLTYPE GetDataHere(FORMATETC* format,STGMEDIUM* out) override {return source->GetDataHere(format,out);}
  /** 中文：委托 TextData 报告支持的格式与 medium，不读取实际数据。 English: Delegate supported format/medium capability queries to TextData without reading contents. 参数声明 / Declared parameters: FORMATETC* format. */
  HRESULT STDMETHODCALLTYPE QueryGetData(FORMATETC* format) override {return source->QueryGetData(format);}
  /** 中文：保留 TextData 的标准格式答复，不另行创建格式转换。 English: Retain TextData's canonical-format response without introducing conversion. 参数声明 / Declared parameters: FORMATETC* a,FORMATETC* b. */
  HRESULT STDMETHODCALLTYPE GetCanonicalFormatEtc(FORMATETC* a,FORMATETC* b) override {return source->GetCanonicalFormatEtc(a,b);}
  /** 中文：委托 TextData 的设置结果，此只读探针源按现有契约不实现写入。 English: Delegate setting to TextData, whose existing read-only probe contract does not implement writes. 参数声明 / Declared parameters: FORMATETC* f,STGMEDIUM* m,BOOL release. */
  HRESULT STDMETHODCALLTYPE SetData(FORMATETC* f,STGMEDIUM* m,BOOL release) override {return source->SetData(f,m,release);}
  /** 中文：按 noenum/binaryonly 故障模式拒绝枚举或仅暴露二进制格式，其余只暴露 Unicode HGLOBAL，并拒绝非读取方向。 English: Refuse enumeration in noenum or expose only binary in binaryonly, otherwise expose Unicode HGLOBAL and reject non-read directions. 参数声明 / Declared parameters: DWORD direction,IEnumFORMATETC** out. */
  HRESULT STDMETHODCALLTYPE EnumFormatEtc(DWORD direction,IEnumFORMATETC** out) override {
    if(mode=="noenum"){if(out)*out=nullptr;return E_NOTIMPL;}
    if(direction!=DATADIR_GET)return E_NOTIMPL;
    FORMATETC format{CLIPFORMAT(mode=="binaryonly"?binary:CF_UNICODETEXT),nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL};
    return SHCreateStdEnumFmtEtc(1,&format,out);
  }
  /** 中文：委托 TextData 的不支持通知结果，探针不实现数据推送订阅。 English: Delegate TextData's unsupported advisory result without implementing probe push subscriptions. 参数声明 / Declared parameters: FORMATETC* f,DWORD a,IAdviseSink* s,DWORD* c. */
  HRESULT STDMETHODCALLTYPE DAdvise(FORMATETC* f,DWORD a,IAdviseSink* s,DWORD* c) override {return source->DAdvise(f,a,s,c);}
  /** 中文：委托 TextData 的不支持取消通知结果，保持 HRESULT。 English: Delegate TextData's unsupported advisory-cancellation result and preserve HRESULT. 参数声明 / Declared parameters: DWORD c. */
  HRESULT STDMETHODCALLTYPE DUnadvise(DWORD c) override {return source->DUnadvise(c);}
  /** 中文：委托 TextData 的不支持通知枚举结果，保持输出契约。 English: Delegate TextData's unsupported advisory-enumeration result with its output contract. 参数声明 / Declared parameters: IEnumSTATDATA** out. */
  HRESULT STDMETHODCALLTYPE EnumDAdvise(IEnumSTATDATA** out) override {return source->EnumDAdvise(out);}
};
/** 中文：解析私有命令以驱动真实控件/键盘、嵌套创建、OLE preflight 和 WinRT 缓存访问，返回结构化结果并按分支平衡临时句柄/COM 引用。 English: Dispatch private commands to real controls/keyboard/nested creation/OLE preflight/WinRT cached access, emit structured results and balance temporary handles/COM references per branch. 参数声明 / Declared parameters: const std::string& line. */
static void interfaceCommand(const std::string& line) {
  const auto split=line.find('\t');const auto action=line.substr(0,split);
  const auto text=split==std::string::npos?L"":wide(line.substr(split+1));
  if(action.rfind("nested-",0)==0) {
    if(nestedParent){DestroyWindow(nestedParent);nestedParent=nullptr;}
    const bool ansi=action.rfind("nested-a-",0)==0;
    NestedControl context{action.substr(9),text,L"",false};
    const HINSTANCE instance=GetModuleHandleW(nullptr);
    const HWND parent=ansi?CreateWindowExA(0,"SakuraClipboardNestedAnsi","owned nested",WS_CHILD,0,0,100,100,window,nullptr,instance,&context):
      CreateWindowExW(0,L"SakuraClipboardNestedWide",L"owned nested",WS_CHILD,0,0,100,100,window,nullptr,instance,&context);
    const DWORD error=GetLastError();nestedParent=parent;
    result(parent && context.created,error,context.after);return;
  }
  if(action.rfind("ole-probe-",0)==0){
    auto object=new ProbedOleData(text,action.substr(10));const HRESULT answer=OleSetClipboard(object);
    std::cout<<"{\"ok\":"<<(SUCCEEDED(answer)?"true":"false")<<",\"error\":"<<DWORD(answer)<<",\"preflightReads\":"<<object->reads<<"}"<<std::endl;
    object->Release();return;
  }
  HWND* control=nullptr;std::string kind;
  for(const auto& name:{std::string("edit"),std::string("rich"),std::string("editansi"),std::string("richansi")})
    if(action.rfind(name+"-",0)==0){kind=name;control=name=="edit"?&editControl:name=="rich"?&richControl:name=="editansi"?&editAnsiControl:&richAnsiControl;break;}
  if(control) {
    const auto operation=action.substr(kind.size()+1);
    if(operation=="recreate"){
      const uintptr_t old=reinterpret_cast<uintptr_t>(*control);if(*control)DestroyWindow(*control);
      *control=makeControl(kind);
      std::cout<<"{\"ok\":"<<(*control?"true":"false")<<",\"old\":\""<<old<<"\",\"next\":\""<<reinterpret_cast<uintptr_t>(*control)<<"\"}"<<std::endl;return;
    }
    const HWND target=*control;
    if(!target){result(false,ERROR_NOT_SUPPORTED);return;}
    if(operation=="confirm"){
      if(text.size()!=64){result(false,ERROR_INVALID_PARAMETER);return;}
      const UINT message=RegisterWindowMessageW((L"SakuraClipboard.Controls."+text).c_str());
      const auto reply=SendMessageW(target,message,0,0);
      std::cout<<"{\"ok\":"<<(reply==0x53434c50?"true":"false")<<",\"reply\":"<<reply<<"}"<<std::endl;return;
    }
    SetWindowTextW(target,operation=="paste"?L"":text.c_str());
    SendMessageW(target,EM_SETSEL,0,-1);SetFocus(target);SetLastError(0);
    if(operation=="diagnostic"){
      CHARRANGE selection{};SendMessageW(target,EM_EXGETSEL,0,reinterpret_cast<LPARAM>(&selection));
      std::vector<wchar_t> selected(size_t(text.size())+16,0);
      const auto count=SendMessageW(target,EM_GETSELTEXT,0,reinterpret_cast<LPARAM>(selected.data()));
      IRichEditOle* rich=nullptr;IDataObject* data=nullptr;
      SendMessageW(target,EM_GETOLEINTERFACE,0,reinterpret_cast<LPARAM>(&rich));
      HRESULT answer=rich?rich->GetClipboardData(&selection,RECO_COPY,&data):E_POINTER;
      std::string formats="[";unsigned index=0;
      if(SUCCEEDED(answer)&&data){IEnumFORMATETC* enumeration=nullptr;
        if(SUCCEEDED(data->EnumFormatEtc(DATADIR_GET,&enumeration))&&enumeration){
          FORMATETC format{};ULONG fetched=0;
          while(index<32&&enumeration->Next(1,&format,&fetched)==S_OK&&fetched){
            STGMEDIUM medium{};const auto supplied=data->GetData(&format,&medium);
            if(index++)formats+=',';
            formats+="{\"format\":"+std::to_string(format.cfFormat)+",\"tymed\":"+std::to_string(format.tymed)+",\"aspect\":"+std::to_string(format.dwAspect)+",\"supplied\":"+std::to_string(DWORD(supplied))+",\"medium\":"+std::to_string(medium.tymed)+"}";
            if(SUCCEEDED(supplied))ReleaseStgMedium(&medium);if(format.ptd)CoTaskMemFree(format.ptd);format={};fetched=0;
          }enumeration->Release();
        }data->Release();
      }if(rich)rich->Release();formats+=']';
      std::cout<<"{\"ok\":true,\"first\":"<<selection.cpMin<<",\"last\":"<<selection.cpMax<<",\"selectedCount\":"<<count<<",\"selected\":"<<json(selected.data())<<",\"objectResult\":"<<DWORD(answer)<<",\"formats\":"<<formats<<"}"<<std::endl;return;
    }
    unsigned translated=0;
    if(operation.rfind("key-",0)==0){
      BYTE original[256]{},keys[256]{};GetKeyboardState(original);
      const auto binding=operation.substr(4);
      const bool shift=binding=="shift-delete";keys[shift?VK_SHIFT:VK_CONTROL]=0x80;
      if(!SetKeyboardState(keys)){result(false,GetLastError());return;}
      const UINT key=binding=="ctrl-c"?'C':binding=="ctrl-x"?'X':binding=="ctrl-insert"?VK_INSERT:VK_DELETE;
      const LPARAM scan=LPARAM(MapVirtualKeyW(key,MAPVK_VK_TO_VSC)<<16)|1;
      SendMessageW(target,WM_KEYDOWN,key,scan);
      MSG keyboard{};keyboard.hwnd=target;keyboard.message=WM_KEYDOWN;keyboard.wParam=key;keyboard.lParam=scan;
      TranslateMessage(&keyboard);
      MSG pending{};while(PeekMessageW(&pending,target,WM_KEYFIRST,WM_KEYLAST,PM_REMOVE)){
        if(pending.message==WM_CHAR)++translated;DispatchMessageW(&pending);
      }
      SendMessageW(target,WM_KEYUP,key,scan|LPARAM(0xc0000000u));SetKeyboardState(original);
    }else {
      if(operation=="selection-copy"){
        const auto selected=text.find(L"owned safe slice");
        if(selected==std::wstring::npos){result(false,ERROR_INVALID_PARAMETER);return;}
        SendMessageW(target,EM_SETSEL,selected,selected+std::wstring(L"owned safe slice").size());
      }
      SendMessageW(target,operation=="paste"?WM_PASTE:operation=="cut"?WM_CUT:WM_COPY,0,0);
    }
    const DWORD error=GetLastError();
    std::wstring value(size_t(GetWindowTextLengthW(target))+1,L'\0');
    GetWindowTextW(target,value.data(),int(value.size()));value.resize(std::wcslen(value.c_str()));
    if(operation.rfind("key-",0)==0)std::cout<<"{\"ok\":true,\"error\":"<<error<<",\"text\":"<<json(value)<<",\"translatedChars\":"<<translated<<"}"<<std::endl;
    else result(true,error,value);return;
  }
  if(action=="winrt-status") {result(SUCCEEDED(winrtInitialization),DWORD(winrtInitialization));return;}
  if(action=="winrt-copy") {const auto answer=winrtCopy(text);result(SUCCEEDED(answer),DWORD(answer));return;}
  if(action=="winrt-cache") {
    if(winrtCached){winrtCached->Release();winrtCached=nullptr;}
    const auto answer=winrtView(&winrtCached);result(SUCCEEDED(answer),DWORD(answer));return;
  }
  if(action=="winrt-read"||action=="winrt-read-cached") {
    IUnknown* view=winrtCached;HRESULT answer=S_OK;
    if(action=="winrt-read")answer=winrtView(&view);
    std::wstring value;if(SUCCEEDED(answer))answer=winrtText(view,value);
    if(action=="winrt-read"&&view)view->Release();result(SUCCEEDED(answer),DWORD(answer),value);return;
  }
  standardFixtureCommand(line);
}
/** 中文：创建带关闭即终止的自有 Job，先暂停启动净凭据孩子、绑定 Job 后恢复并等待退出；失败清理精确孩子与句柄。 English: Create an owned kill-on-close Job, start a net-credentials child suspended, assign before resume and wait for exit; clean exact child/handles on failure. 参数声明 / Declared parameters: const std::wstring& executable,std::wstring command,std::wstring desktop=L"". */
static int ownedLaunch(const std::wstring& executable,std::wstring command,std::wstring desktop=L"") {
  const HANDLE job=CreateJobObjectW(nullptr,nullptr);if(!job)return 9;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits))){CloseHandle(job);return 9;}
  STARTUPINFOW startup{};startup.cb=sizeof(startup);if(!desktop.empty())startup.lpDesktop=desktop.data();
  startup.dwFlags=STARTF_USESHOWWINDOW;startup.wShowWindow=SW_HIDE;PROCESS_INFORMATION child{};
  wchar_t* environment=GetEnvironmentStringsW();
  const BOOL started=CreateProcessWithLogonW(L"SakuraClipboardFixture",L".",L"unused-test-credentials",LOGON_NETCREDENTIALS_ONLY,
    executable.c_str(),command.data(),CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT|CREATE_SUSPENDED,environment,nullptr,&startup,&child);
  const DWORD error=GetLastError();FreeEnvironmentStringsW(environment);
  if(!started){std::cerr<<"Owned launch "<<error<<std::endl;CloseHandle(job);return 9;}
  if(!AssignProcessToJobObject(job,child.hProcess) || ResumeThread(child.hThread)==DWORD(-1)){
    TerminateProcess(child.hProcess,9);CloseHandle(child.hThread);CloseHandle(child.hProcess);CloseHandle(job);return 9;
  }
  CloseHandle(child.hThread);WaitForSingleObject(child.hProcess,INFINITE);DWORD code=0;GetExitCodeProcess(child.hProcess,&code);CloseHandle(child.hProcess);CloseHandle(job);return int(code);
}
/** 中文：核对参数数目和非交互 station，单独引用托管 EXE 参数并指定私有 desktop 后委托 Job 启动。 English: Validate argument count/noninteractive station, quote managed EXE arguments separately and delegate Job launch with private desktop. 参数声明 / Declared parameters: int argc,wchar_t** argv. */
static int managedLaunch(int argc,wchar_t** argv) {
  if(argc!=6||std::wstring(argv[4]).empty()||CompareStringOrdinal(argv[4],-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)return 2;
  return ownedLaunch(argv[2],clipboardArgument(argv[2])+L" "+clipboardArgument(argv[3])+L" "+clipboardArgument(argv[4])+L" "+clipboardArgument(argv[5]),std::wstring(argv[4])+L"\\default");
}
/** 中文：核对宿主加托管 DLL 的参数结构和私有 station，保留宿主 argv 顺序并委托自有 Job 启动。 English: Validate host-plus-managed-DLL argument structure/private station and retain host argv order for owned-Job launch. 参数声明 / Declared parameters: int argc,wchar_t** argv. */
static int managedHostLaunch(int argc,wchar_t** argv) {
  if(argc!=7||std::wstring(argv[5]).empty()||CompareStringOrdinal(argv[5],-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)return 2;
  return ownedLaunch(argv[2],clipboardArgument(argv[2])+L" "+clipboardArgument(argv[3])+L" "+clipboardArgument(argv[4])+L" "+clipboardArgument(argv[5])+L" "+clipboardArgument(argv[6]),std::wstring(argv[5])+L"\\default");
}
/** 中文：分派自有启动/托管启动模式，建立私有 station、真实 GUI/OLE/WinRT 探针和命令消息循环；输出环境身份，结束释放缓存与窗口。 English: Dispatch owned/managed launch modes, establish private station/real GUI/OLE/WinRT probes and a command message loop, report environment identity and release caches/windows on exit. 参数声明 / Declared parameters: int argc,wchar_t** argv. */
int wmain(int argc,wchar_t** argv) {
  if(argc==3&&std::wstring(argv[1])==L"--launch"){
    wchar_t executable[32768]{};if(!GetModuleFileNameW(nullptr,executable,32768))return 2;
    return ownedLaunch(executable,clipboardArgument(executable)+L" --create "+clipboardArgument(argv[2]));
  }
  if(argc>=2&&std::wstring(argv[1])==L"--managed-launch")return managedLaunch(argc,argv);
  if(argc>=2&&std::wstring(argv[1])==L"--managed-host-launch")return managedHostLaunch(argc,argv);
  std::wstring stationArgument=argc==2?argv[1]:L"";
  const bool create=argc==3&&std::wstring(argv[1])==L"--create";
  const bool join=argc==4&&std::wstring(argv[3])==L"--native-peer";
  if(create||join) {
    stationArgument=create?L"--create":argv[2];
    const HANDLE pipe=CreateFileW(argv[create?2:1],GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);
    if(pipe==INVALID_HANDLE_VALUE)return 10;
    const int file=_open_osfhandle(reinterpret_cast<intptr_t>(pipe),_O_RDWR|_O_BINARY);
    if(file<0||!std::freopen("NUL","rb",stdin)||!std::freopen("NUL","wb",stdout)||_dup2(file,_fileno(stdin))||_dup2(file,_fileno(stdout)))return 10;
    _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);std::cin.clear();std::cout.clear();argc=2;
  }
  if(argc!=2)return 2;
  HWINSTA station=nullptr;
  if(stationArgument==L"--create") {
    HANDLE token=nullptr;DWORD size=0;if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))return 2;
    GetTokenInformation(token,TokenUser,nullptr,0,&size);std::vector<unsigned char> contents(size);
    if(!GetTokenInformation(token,TokenUser,contents.data(),size,&size))return 2;CloseHandle(token);
    wchar_t* sid=nullptr;if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(contents.data())->User.Sid,&sid))return 2;
    const std::wstring text=L"D:P(A;;GA;;;"+std::wstring(sid)+L")(A;;GA;;;SY)";LocalFree(sid);
    PSECURITY_DESCRIPTOR descriptor=nullptr;
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(text.c_str(),SDDL_REVISION_1,&descriptor,nullptr))return 2;
    SECURITY_ATTRIBUTES attributes{sizeof(attributes),descriptor,FALSE};station=CreateWindowStationW(nullptr,1,WINSTA_ALL_ACCESS,&attributes);LocalFree(descriptor);
  }else {
    if(stationArgument.empty()||CompareStringOrdinal(stationArgument.c_str(),-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)return 3;
    station=OpenWindowStationW(stationArgument.c_str(),FALSE,WINSTA_ALL_ACCESS);
  }
  if(!station||!SetProcessWindowStation(station))return 3;
  USEROBJECTFLAGS flags{};DWORD count=0;
  if(!GetUserObjectInformationW(station,UOI_FLAGS,&flags,sizeof(flags),&count)||(flags.dwFlags&WSF_VISIBLE))return 3;
  const HDESK desktop=CreateDesktopW(L"default",nullptr,nullptr,0,GENERIC_ALL,nullptr);
  if(!desktop||!SetThreadDesktop(desktop)||FAILED(OleInitialize(nullptr)))return 4;
  WNDCLASSW definition{};definition.lpfnWndProc=procedure;definition.lpszClassName=L"SakuraClipboardInterfaceWindow";definition.hInstance=GetModuleHandleW(nullptr);
  if(!RegisterClassW(&definition))return 6;
  WNDCLASSW nestedWide{};nestedWide.lpfnWndProc=nestedControlProcedure;nestedWide.lpszClassName=L"SakuraClipboardNestedWide";nestedWide.hInstance=GetModuleHandleW(nullptr);
  WNDCLASSA nestedAnsi{};nestedAnsi.lpfnWndProc=nestedControlProcedure;nestedAnsi.lpszClassName="SakuraClipboardNestedAnsi";nestedAnsi.hInstance=GetModuleHandleW(nullptr);
  if(!RegisterClassW(&nestedWide)||!RegisterClassA(&nestedAnsi))return 6;
  window=CreateWindowExW(0,definition.lpszClassName,L"owned interfaces",WS_OVERLAPPEDWINDOW,0,0,400,200,nullptr,nullptr,definition.hInstance,nullptr);
  if(!window)return 7;
  editControl=makeControl("edit");editAnsiControl=makeControl("editansi");
  const HMODULE rich=LoadLibraryExW(L"msftedit.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
  if(rich)richControl=makeControl("rich");
  const HMODULE richAnsi=LoadLibraryExW(L"riched20.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
  if(richAnsi)richAnsiControl=makeControl("richansi");
  ShowWindow(window,SW_SHOW);SetForegroundWindow(window);SetActiveWindow(window);SetFocus(editControl);
  binary=RegisterClipboardFormatW(L"Sakura fixture binary");winrtInitialization=winrtStart();
  MSG message{};PeekMessageW(&message,nullptr,0,0,PM_NOREMOVE);const DWORD thread=GetCurrentThreadId();
  wchar_t name[256]{};if(!GetUserObjectInformationW(station,UOI_NAME,name,sizeof(name),&count))return 8;
  BOOL inJob=FALSE;if(!IsProcessInJob(GetCurrentProcess(),nullptr,&inJob)||!inJob)return 9;
  std::cout<<"{\"pid\":"<<GetCurrentProcessId()<<",\"created\":\""<<processCreation(GetCurrentProcess())<<"\",\"station\":"<<json(name)
    <<",\"privateStation\":true,\"jobBound\":true,\"edit\":"<<(editControl?"true":"false")<<",\"rich\":"<<(richControl?"true":"false")
    <<",\"editansi\":"<<(editAnsiControl?"true":"false")<<",\"richansi\":"<<(richAnsiControl?"true":"false")
    <<",\"foregroundOwned\":"<<(GetForegroundWindow()==window?"true":"false")<<",\"winrtInitialization\":"<<DWORD(winrtInitialization)<<'}'<<std::endl;
  const HANDLE replied=CreateEventW(nullptr,FALSE,FALSE,nullptr);
  std::thread input(/** 中文：输入线程按一问一答投递堆上命令给 GUI 线程并等待回复事件，投递失败自行删除；EOF 投递退出，不在输入线程操作 STA 对象。 English: The input thread posts heap-owned commands one at a time to the GUI thread and waits for replies, deleting on posting failure; EOF posts quit without touching STA objects on the input thread. */ [thread,replied](){std::string line;while(std::getline(std::cin,line)){auto contents=new std::string(std::move(line));
    if(!PostThreadMessageW(thread,WM_APP,0,reinterpret_cast<LPARAM>(contents))){delete contents;break;}WaitForSingleObject(replied,INFINITE);}PostThreadMessageW(thread,WM_QUIT,0,0);});
  while(GetMessageW(&message,nullptr,0,0)>0){if(message.message==WM_APP){auto contents=reinterpret_cast<std::string*>(message.lParam);interfaceCommand(*contents);delete contents;SetEvent(replied);}else{TranslateMessage(&message);DispatchMessageW(&message);}}
  input.detach();if(winrtCached)winrtCached->Release();if(winrtClipboard)winrtClipboard->Release();if(cached)cached->Release();DestroyWindow(window);OleUninitialize();return 0;
}
