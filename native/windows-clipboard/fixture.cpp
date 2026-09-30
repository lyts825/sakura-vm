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
#include <io.h>
#include <fcntl.h>

static HWND window=nullptr;
static IDataObject* cached=nullptr;
static std::wstring delayed;
static UINT binary=0;
static std::string utf8(const std::wstring& text) {
  const int count=WideCharToMultiByte(CP_UTF8,0,text.data(),int(text.size()),nullptr,0,nullptr,nullptr);
  std::string result(count,'\0');
  if (count) WideCharToMultiByte(CP_UTF8,0,text.data(),int(text.size()),result.data(),count,nullptr,nullptr);
  return result;
}
static std::wstring wide(const std::string& text) {
  const int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),int(text.size()),nullptr,0);
  std::wstring result(count,L'\0');
  if (count) MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),int(text.size()),result.data(),count);
  return result;
}
static std::string json(const std::wstring& text) {
  std::string result="\"";
  for (const unsigned char c:utf8(text)) {
    if (c=='"'||c=='\\') {result+='\\';result+=char(c);}
    else if (c=='\n') result+="\\n";
    else if (c=='\r') result+="\\r";
    else if (c=='\t') result+="\\t";
    else if (c>=32) result+=char(c);
  }
  return result+'"';
}
static HGLOBAL textMemory(const std::wstring& text) {
  const SIZE_T bytes=(text.size()+1)*sizeof(wchar_t);
  HGLOBAL memory=GlobalAlloc(GMEM_MOVEABLE,bytes);
  if (!memory) return nullptr;
  void* contents=GlobalLock(memory);
  if (!contents) {GlobalFree(memory);return nullptr;}
  std::memcpy(contents,text.c_str(),bytes);
  GlobalUnlock(memory);return memory;
}
static void result(bool ok,DWORD error=0,const std::wstring& text=L"") {
  std::cout<<"{\"ok\":"<<(ok?"true":"false")<<",\"error\":"<<error<<",\"text\":"<<json(text)<<'}'<<std::endl;
}
class TextData final:public IDataObject {
  LONG references=1;
  std::wstring text;
  bool rich;
public:
  explicit TextData(std::wstring value,bool other=false):text(std::move(value)),rich(other) {}
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
    if (!out) return E_POINTER;
    *out=nullptr;
    if (id!=IID_IUnknown && id!=IID_IDataObject) return E_NOINTERFACE;
    *out=static_cast<IDataObject*>(this);AddRef();return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override {return ULONG(InterlockedIncrement(&references));}
  ULONG STDMETHODCALLTYPE Release() override {const LONG next=InterlockedDecrement(&references);if(!next)delete this;return ULONG(next);}
  HRESULT STDMETHODCALLTYPE GetData(FORMATETC* format,STGMEDIUM* out) override {
    if (!format || !out) return E_POINTER;
    *out={};
    const auto answer=QueryGetData(format);
    if (FAILED(answer)) return answer;
    out->hGlobal=textMemory(text); out->tymed=TYMED_HGLOBAL;return out->hGlobal?S_OK:E_OUTOFMEMORY;
  }
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
  HRESULT STDMETHODCALLTYPE QueryGetData(FORMATETC* format) override {
    return format && (format->cfFormat==CF_UNICODETEXT || (rich && format->cfFormat==binary)) && (format->tymed&TYMED_HGLOBAL) && format->dwAspect==DVASPECT_CONTENT ? S_OK:DV_E_FORMATETC;
  }
  HRESULT STDMETHODCALLTYPE GetCanonicalFormatEtc(FORMATETC*,FORMATETC* out) override {if(out)out->ptd=nullptr;return DATA_S_SAMEFORMATETC;}
  HRESULT STDMETHODCALLTYPE SetData(FORMATETC*,STGMEDIUM*,BOOL) override {return E_NOTIMPL;}
  HRESULT STDMETHODCALLTYPE EnumFormatEtc(DWORD direction,IEnumFORMATETC** out) override {
    if (direction!=DATADIR_GET) return E_NOTIMPL;
    FORMATETC formats[2]{{CF_UNICODETEXT,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL},{CLIPFORMAT(binary),nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL}};
    return SHCreateStdEnumFmtEtc(rich?2:1,formats,out);
  }
  HRESULT STDMETHODCALLTYPE DAdvise(FORMATETC*,DWORD,IAdviseSink*,DWORD*) override {return OLE_E_ADVISENOTSUPPORTED;}
  HRESULT STDMETHODCALLTYPE DUnadvise(DWORD) override {return OLE_E_ADVISENOTSUPPORTED;}
  HRESULT STDMETHODCALLTYPE EnumDAdvise(IEnumSTATDATA**) override {return OLE_E_ADVISENOTSUPPORTED;}
};
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
static LRESULT CALLBACK procedure(HWND handle,UINT message,WPARAM a,LPARAM b) {
  if(message==WM_RENDERFORMAT && a==CF_UNICODETEXT) {
    HGLOBAL data=textMemory(delayed);
    if(!SetClipboardData(CF_UNICODETEXT,data))GlobalFree(data);
    return 0;
  }
  return DefWindowProcW(handle,message,a,b);
}
int wmain(int argc,wchar_t** argv) {
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
  if(argc==3 && std::wstring(argv[1])==L"--create") {
    HANDLE pipe=CreateFileW(argv[2],GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);
    if(pipe==INVALID_HANDLE_VALUE)return 10;
    const int file=_open_osfhandle(reinterpret_cast<intptr_t>(pipe),_O_RDWR|_O_BINARY);
    if(file<0 || _dup2(file,0) || _dup2(file,1))return 10;
    _setmode(0,_O_BINARY);_setmode(1,_O_BINARY);
    argc=2;
  }
  if(argc!=2)return 2;
  HWINSTA station=nullptr;
  if(std::wstring(argv[1])==L"--create") {
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
  } else station=OpenWindowStationW(argv[1],FALSE,WINSTA_ALL_ACCESS);
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
  std::cout<<"{\"pid\":"<<GetCurrentProcessId()<<",\"created\":\""<<processCreation(GetCurrentProcess())<<"\",\"station\":"<<json(stationName)<<'}'<<std::endl;
  HANDLE replied=CreateEventW(nullptr,FALSE,FALSE,nullptr);
  std::thread input([thread,replied](){std::string line;while(std::getline(std::cin,line)){
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
