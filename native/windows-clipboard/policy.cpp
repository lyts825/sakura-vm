#include "protocol.h"
#include "early-import.h"
#include "vendor/minhook/include/MinHook.h"
#include <ole2.h>
#include <algorithm>
#include <cstring>
#include <cctype>
#include <regex>
#include <string>
#include <vector>

#ifndef SAKURA_CLIPBOARD_BUILD
#error The native build identity is required
#endif

static SakuraClipboardPolicy* shared = nullptr;
static HANDLE section = nullptr;
static std::wstring sectionName;
static SRWLOCK configureLock = SRWLOCK_INIT;
static thread_local unsigned oleTransport=0;
struct OleTransportScope {
  OleTransportScope() { ++oleTransport; }
  ~OleTransportScope() { --oleTransport; }
};
static bool oleMetadata(UINT format) {
  if (!oleTransport || format<0xc000) return false;
  wchar_t name[64]{};
  return GetClipboardFormatNameW(format,name,64) &&
    (std::wcscmp(name,L"DataObject")==0 || std::wcscmp(name,L"Ole Private Data")==0);
}
struct Rule { bool active; uint32_t flags, maximum; };
static Rule current() {
  if (!shared) return {true, 0, 1024};
  for (int attempt=0; attempt<32; ++attempt) {
    const LONG before=InterlockedCompareExchange(&shared->sequence,0,0);
    if (before & 1) continue;
    const Rule result{shared->active != 0, shared->flags, shared->maxTextBytes};
    MemoryBarrier();
    if (before != InterlockedCompareExchange(&shared->sequence,0,0)) continue;
    if (shared->magic!=SakuraClipboardMagic || shared->version!=SakuraClipboardVersion ||
        shared->pid!=GetCurrentProcessId() || shared->creationTime!=processCreation(GetCurrentProcess()) ||
        std::memcmp(shared->build,SAKURA_CLIPBOARD_BUILD,65)!=0 || result.maximum<1024 || result.maximum>1048576)
      break;
    return result;
  }
  return {true,0,1024};
}
static void blocked(bool copy) {
  if (shared) InterlockedIncrement64(copy ? &shared->blockedCopy : &shared->blockedPaste);
  SetLastError(ERROR_ACCESS_DENIED);
}
static bool direction(bool copy) {
  const auto rule=current();
  return !rule.active || (rule.flags & (copy ? CopyAllowed : PasteAllowed));
}
static bool formatAllowed(UINT format, const Rule& rule) {
  return !rule.active || format==CF_TEXT || format==CF_UNICODETEXT || format==CF_OEMTEXT ||
    format==CF_LOCALE || ((rule.flags & FilesAllowed) && !(rule.flags & Sensitive));
}
static bool sensitive(const std::string& text) {
  const auto base64=[](unsigned char c){return (c>='a'&&c<='z') || (c>='A'&&c<='Z') || (c>='0'&&c<='9') || c=='_' || c=='-';};
  // Scan variable-length JWT and URL fields iteratively. std::regex's recursive
  // repetition can exhaust an application's stack on an otherwise valid 1 MiB
  // clipboard; the remaining expressions below all have bounded repetition.
  for(size_t start=0;(start=text.find("eyJ",start))!=std::string::npos;){
    if(start && (std::isalnum(static_cast<unsigned char>(text[start-1])) || text[start-1]=='_')){start+=3;continue;}
    size_t first=start;while(first<text.size() && base64(static_cast<unsigned char>(text[first])))++first;
    if(first-start>=11 && first<text.size() && text[first]=='.'){
      size_t second=first+1;while(second<text.size() && base64(static_cast<unsigned char>(text[second])))++second;
      if(second-first-1>=8 && second<text.size() && text[second]=='.'){
        size_t third=second+1;while(third<text.size() && base64(static_cast<unsigned char>(text[third])))++third;
        if(third-second-1>=16)return true;
      }
    }
    start=std::max(start+3,first);
  }
  std::string lower=text;
  for(auto& c:lower)c=char(std::tolower(static_cast<unsigned char>(c)));
  for(size_t start=0;(start=lower.find("http",start))!=std::string::npos;){
    const size_t length=lower.compare(start,7,"http://")==0?7:lower.compare(start,8,"https://")==0?8:0;
    if(!length){start+=4;continue;}
    const size_t begin=start+length;
    size_t end=begin;while(end<text.size() && text[end]!='/' && text[end]!='@' && !std::isspace(static_cast<unsigned char>(text[end])))++end;
    const size_t colon=text.find(':',begin);
    if(end<text.size() && text[end]=='@' && colon!=std::string::npos && colon>begin && colon<end && end-colon-1>=6)return true;
    start=std::max(start+4,end);
  }
  static const std::vector<std::regex> patterns{
    std::regex("-----BEGIN (?:[A-Z0-9]{1,32} )?PRIVATE KEY-----|PuTTY-User-Key-File-[0-9]{1,8}:"),
    std::regex("\\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255}|xox[baprs]-[A-Za-z0-9-]{20,255}|sk-[A-Za-z0-9_-]{20,255})\\b"),
    std::regex("\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b"),
    std::regex("\\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key)[\"']?\\s{0,128}[:=]\\s{0,128}[\"']?[^\\s\"'`]{12}",std::regex::icase)
  };
  for (const auto& pattern:patterns) if (std::regex_search(text,pattern)) return true;
  return false;
}
static bool contentAllowed(UINT format, HANDLE data, const Rule& rule) {
  if (!rule.active) return true;
  if (!formatAllowed(format,rule)) return false;
  if (format!=CF_TEXT && format!=CF_UNICODETEXT && format!=CF_OEMTEXT) return true;
  // A delayed-rendering placeholder carries no text. The later SetClipboardData
  // or guarded OLE GetData must supply bytes and passes this check again.
  if (!data) return true;
  const SIZE_T size=GlobalSize(data);
  if (!size || size>SIZE_T(rule.maximum)*4+8) return false;
  const void* bytes=GlobalLock(data);
  if (!bytes) return false;
  bool allowed=false;
  try {
    std::wstring wide;
    if (format==CF_UNICODETEXT) {
      const auto first=static_cast<const wchar_t*>(bytes), last=first+size/sizeof(wchar_t);
      const auto end=std::find(first,last,L'\0');
      if (end==last) throw 0;
      wide.assign(first,end);
    } else {
      const auto first=static_cast<const char*>(bytes), last=first+size;
      const auto end=std::find(first,last,'\0');
      if (end==last) throw 0;
      const int length=int(end-first);
      const UINT encoding=format==CF_OEMTEXT ? CP_OEMCP : CP_ACP;
      const int count=MultiByteToWideChar(encoding,0,first,length,nullptr,0);
      if (length && !count) throw 0;
      wide.resize(count);
      if (count && !MultiByteToWideChar(encoding,0,first,length,wide.data(),count)) throw 0;
    }
    const int count=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide.data(),int(wide.size()),nullptr,0,nullptr,nullptr);
    if ((!wide.empty() && !count) || uint32_t(count)>rule.maximum) throw 0;
    std::string text(count,'\0');
    if (count && !WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide.data(),int(wide.size()),text.data(),count,nullptr,nullptr)) throw 0;
    allowed=!(rule.flags & Sensitive) || !sensitive(text);
  } catch (...) { allowed=false; }
  GlobalUnlock(data);
  return allowed;
}

static decltype(&GetClipboardData) originalGet=nullptr;
static decltype(&SetClipboardData) originalSet=nullptr;
static decltype(&EmptyClipboard) originalEmpty=nullptr;
static decltype(&IsClipboardFormatAvailable) originalAvailable=nullptr;
static decltype(&EnumClipboardFormats) originalEnum=nullptr;
static decltype(&CountClipboardFormats) originalCount=nullptr;
static decltype(&GetPriorityClipboardFormat) originalPriority=nullptr;
static decltype(&GetUpdatedClipboardFormats) originalUpdated=nullptr;
static decltype(&OleGetClipboard) originalOleGet=nullptr;
static decltype(&OleSetClipboard) originalOleSet=nullptr;
static decltype(&OleFlushClipboard) originalOleFlush=nullptr;
static HANDLE WINAPI getData(UINT format) {
  auto rule=current();
  // OLE transports its object/format metadata through two registered user32
  // formats. Only an already-authorized OLE call may access this metadata;
  // actual application data still goes through GuardedData below.
  if (oleMetadata(format)) return originalGet(format);
  if (!direction(false) || !formatAllowed(format,rule)) { blocked(false); return nullptr; }
  const HANDLE data=originalGet(format);
  rule=current();
  if (!direction(false) || (data && !contentAllowed(format,data,rule))) { blocked(false); return nullptr; }
  return data;
}
static HANDLE WINAPI setData(UINT format,HANDLE data) {
  const auto rule=current();
  if (!direction(true) || (!oleMetadata(format) && !contentAllowed(format,data,rule))) { blocked(true); return nullptr; }
  return originalSet(format,data);
}
static BOOL WINAPI empty() {
  if (!direction(true)) { blocked(true); return FALSE; }
  return originalEmpty();
}
static BOOL WINAPI available(UINT format) {
  return direction(false) && formatAllowed(format,current()) ? originalAvailable(format) : FALSE;
}
static UINT WINAPI enumerate(UINT previous) {
  if (!direction(false)) return 0;
  const auto rule=current();
  UINT next=previous;
  while ((next=originalEnum(next))!=0) if (formatAllowed(next,rule)) return next;
  return 0;
}
static int WINAPI count() {
  if (!direction(false)) return 0;
  if (!current().active) return originalCount();
  int result=0; UINT next=0;
  while ((next=enumerate(next))!=0 && result<65536) ++result;
  return result;
}
static int WINAPI priority(UINT* formats,int length) {
  if (!direction(false)) return 0;
  if (!current().active) return originalPriority(formats,length);
  if (!formats || length<0 || length>65536) { SetLastError(ERROR_INVALID_PARAMETER); return 0; }
  for (int i=0;i<length;++i) if (available(formats[i])) return int(formats[i]);
  return count() ? -1 : 0;
}
static BOOL WINAPI updated(PUINT formats,UINT length,PUINT filled) {
  if (!filled || (!formats && length)) { SetLastError(ERROR_INVALID_PARAMETER); return FALSE; }
  if (!direction(false)) { *filled=0; blocked(false); return FALSE; }
  if (!current().active) return originalUpdated(formats,length,filled);
  if (length>65536) { SetLastError(ERROR_INVALID_PARAMETER); return FALSE; }
  std::vector<UINT> values(65536); UINT actual=0;
  if (!originalUpdated(values.data(),UINT(values.size()),&actual) || actual>values.size()) return FALSE;
  const auto rule=current(); UINT allowed=0;
  for (UINT i=0;i<actual;++i) if (formatAllowed(values[i],rule)) values[allowed++]=values[i];
  *filled=allowed;
  if (allowed>length) { SetLastError(ERROR_INSUFFICIENT_BUFFER); return FALSE; }
  std::copy(values.begin(),values.begin()+allowed,formats);
  return TRUE;
}

// OLE uses cached IDataObject proxies as well as user32 calls. Check data at each
// GetData, including a proxy obtained before a later policy tightening.
class GuardedFormats final:public IEnumFORMATETC {
  LONG references=1;
  IEnumFORMATETC* source;
  bool copy;
public:
  GuardedFormats(IEnumFORMATETC* value,bool copying):source(value),copy(copying) { source->AddRef(); }
  ~GuardedFormats() { source->Release(); }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
    if(!out)return E_POINTER;
    *out=nullptr;
    if(id!=IID_IUnknown && id!=IID_IEnumFORMATETC)return E_NOINTERFACE;
    *out=static_cast<IEnumFORMATETC*>(this);AddRef();return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override {return ULONG(InterlockedIncrement(&references));}
  ULONG STDMETHODCALLTYPE Release() override {const LONG next=InterlockedDecrement(&references);if(!next)delete this;return ULONG(next);}
  HRESULT STDMETHODCALLTYPE Next(ULONG length,FORMATETC* out,ULONG* fetched) override {
    if(fetched)*fetched=0;
    if(!out || (!fetched && length!=1) || length>65536)return E_INVALIDARG;
    if(!direction(copy)){blocked(copy);return E_ACCESSDENIED;}
    ULONG accepted=0;
    for(ULONG attempts=0;accepted<length && attempts<65536;++attempts){
      FORMATETC value{};ULONG count=0;const HRESULT answer=source->Next(1,&value,&count);
      if(FAILED(answer)){if(value.ptd)CoTaskMemFree(value.ptd);if(fetched)*fetched=accepted;return answer;}
      if(!count)break;
      const auto rule=current();
      const bool plain=value.cfFormat==CF_TEXT || value.cfFormat==CF_UNICODETEXT || value.cfFormat==CF_OEMTEXT;
      if(direction(copy) && formatAllowed(value.cfFormat,rule) && (!rule.active || !plain || (value.tymed&TYMED_HGLOBAL))){
        if(rule.active && plain)value.tymed=TYMED_HGLOBAL;
        out[accepted++]=value;
      }else if(value.ptd)CoTaskMemFree(value.ptd);
    }
    if(fetched)*fetched=accepted;
    return accepted==length?S_OK:S_FALSE;
  }
  HRESULT STDMETHODCALLTYPE Skip(ULONG count) override {
    if(count>65536)return E_INVALIDARG;
    for(ULONG i=0;i<count;++i){FORMATETC value{};ULONG fetched=0;const HRESULT answer=Next(1,&value,&fetched);
      if(value.ptd)CoTaskMemFree(value.ptd);if(answer!=S_OK)return answer;}
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE Reset() override {return source->Reset();}
  HRESULT STDMETHODCALLTYPE Clone(IEnumFORMATETC** out) override {
    if(!out)return E_POINTER;
    *out=nullptr;IEnumFORMATETC* data=nullptr;const HRESULT answer=source->Clone(&data);
    if(FAILED(answer)||!data)return answer;
    try{*out=new GuardedFormats(data,copy);}catch(...){data->Release();return E_OUTOFMEMORY;}
    data->Release();return answer;
  }
};
class GuardedData final:public IDataObject {
  LONG references=1;
  IDataObject* source;
  bool copy;
public:
  GuardedData(IDataObject* value,bool copying):source(value),copy(copying) { source->AddRef(); }
  ~GuardedData() { source->Release(); }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
    if (!out) return E_POINTER;
    *out=nullptr;
    if (id!=IID_IUnknown && id!=IID_IDataObject) return E_NOINTERFACE;
    *out=static_cast<IDataObject*>(this); AddRef(); return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ULONG(InterlockedIncrement(&references)); }
  ULONG STDMETHODCALLTYPE Release() override {
    const LONG remaining=InterlockedDecrement(&references);
    if (!remaining) delete this;
    return ULONG(remaining);
  }
  HRESULT STDMETHODCALLTYPE GetData(FORMATETC* format,STGMEDIUM* result) override {
    if (!format || !result) return E_POINTER;
    *result={};
    auto rule=current();
    if (!direction(copy) || !formatAllowed(format->cfFormat,rule)) { blocked(copy); return E_ACCESSDENIED; }
    STGMEDIUM data{};
    const HRESULT answer=source->GetData(format,&data);
    if (FAILED(answer)) return answer;
    rule=current();
    const bool plain=format->cfFormat==CF_TEXT || format->cfFormat==CF_UNICODETEXT || format->cfFormat==CF_OEMTEXT;
    if (!direction(copy) || (rule.active && ((plain && data.tymed!=TYMED_HGLOBAL) ||
        (data.tymed==TYMED_HGLOBAL && !contentAllowed(format->cfFormat,data.hGlobal,rule))))) {
      ReleaseStgMedium(&data); blocked(copy); return E_ACCESSDENIED;
    }
    *result=data; return answer;
  }
  HRESULT STDMETHODCALLTYPE GetDataHere(FORMATETC* format,STGMEDIUM* result) override {
    if (!current().active) return source->GetDataHere(format,result);
    if (!format || !result) return E_POINTER;
    if (format->tymed!=TYMED_HGLOBAL || result->tymed!=TYMED_HGLOBAL || !result->hGlobal || result->pUnkForRelease)
      return DV_E_TYMED;
    // Render into an owned temporary and inspect it before touching the
    // caller's buffer; never delegate a direct write to an unguarded source.
    STGMEDIUM data{};
    const HRESULT answer=GetData(format,&data);
    if (FAILED(answer)) return answer;
    HRESULT outcome=S_OK;
    const SIZE_T length=data.tymed==TYMED_HGLOBAL ? GlobalSize(data.hGlobal) : 0;
    if (!direction(copy) || (data.tymed==TYMED_HGLOBAL && !contentAllowed(format->cfFormat,data.hGlobal,current()))) {
      blocked(copy); outcome=E_ACCESSDENIED;
    } else if (!length || length>16*1024*1024 || GlobalSize(result->hGlobal)<length) outcome=STG_E_MEDIUMFULL;
    else {
      const void* from=GlobalLock(data.hGlobal);
      void* to=GlobalLock(result->hGlobal);
      if (!from || !to) outcome=E_OUTOFMEMORY;
      else std::memcpy(to,from,length);
      if (from) GlobalUnlock(data.hGlobal);
      if (to) GlobalUnlock(result->hGlobal);
    }
    ReleaseStgMedium(&data);
    return outcome;
  }
  HRESULT STDMETHODCALLTYPE QueryGetData(FORMATETC* format) override {
    if (!format) return E_POINTER;
    if (!direction(copy) || !formatAllowed(format->cfFormat,current())) return E_ACCESSDENIED;
    return source->QueryGetData(format);
  }
  HRESULT STDMETHODCALLTYPE GetCanonicalFormatEtc(FORMATETC* a,FORMATETC* b) override { return source->GetCanonicalFormatEtc(a,b); }
  HRESULT STDMETHODCALLTYPE SetData(FORMATETC* format,STGMEDIUM* value,BOOL release) override {
    if (!format || !value) return E_POINTER;
    if (!direction(true) || (current().active && (value->tymed!=TYMED_HGLOBAL || !contentAllowed(format->cfFormat,value->hGlobal,current())))) {
      blocked(true); return E_ACCESSDENIED;
    }
    return source->SetData(format,value,release);
  }
  HRESULT STDMETHODCALLTYPE EnumFormatEtc(DWORD mode,IEnumFORMATETC** out) override {
    if(!out)return E_POINTER;
    *out=nullptr;
    if(!direction(copy)){blocked(copy);return E_ACCESSDENIED;}
    IEnumFORMATETC* data=nullptr;const HRESULT answer=source->EnumFormatEtc(mode,&data);
    if(FAILED(answer)||!data)return answer;
    try{*out=new GuardedFormats(data,copy);}catch(...){data->Release();return E_OUTOFMEMORY;}
    data->Release();return answer;
  }
  HRESULT STDMETHODCALLTYPE DAdvise(FORMATETC* f,DWORD a,IAdviseSink* s,DWORD* c) override {
    return current().active ? OLE_E_ADVISENOTSUPPORTED : source->DAdvise(f,a,s,c);
  }
  HRESULT STDMETHODCALLTYPE DUnadvise(DWORD c) override { return source->DUnadvise(c); }
  HRESULT STDMETHODCALLTYPE EnumDAdvise(IEnumSTATDATA** out) override {
    return current().active ? OLE_E_ADVISENOTSUPPORTED : source->EnumDAdvise(out);
  }
};
static HRESULT WINAPI oleGet(IDataObject** out) {
  if (!out) return E_POINTER;
  *out=nullptr;
  if (!direction(false)) { blocked(false); return E_ACCESSDENIED; }
  IDataObject* data=nullptr;
  OleTransportScope transport;
  const HRESULT answer=originalOleGet(&data);
  if (FAILED(answer) || !data) return answer;
  try { *out=new GuardedData(data,false); } catch (...) { data->Release(); return E_OUTOFMEMORY; }
  data->Release(); return answer;
}
static HRESULT WINAPI oleSet(IDataObject* data) {
  if (!direction(true)) { blocked(true); return E_ACCESSDENIED; }
  OleTransportScope transport;
  if (!data) return originalOleSet(nullptr);
  GuardedData* wrapped=nullptr;
  try { wrapped=new GuardedData(data,true); } catch (...) { return E_OUTOFMEMORY; }
  const HRESULT result=originalOleSet(wrapped);
  wrapped->Release(); return result;
}
static HRESULT WINAPI oleFlush() {
  if (!direction(true)) { blocked(true); return E_ACCESSDENIED; }
  OleTransportScope transport;
  return originalOleFlush();
}
template<class T> static bool hook(const wchar_t* module,const char* name,void* replacement,T* original) {
  return MH_CreateHookApi(module,name,replacement,reinterpret_cast<void**>(original))==MH_OK;
}
template<class T> static bool earlyHook(T* original,T source,void* replacement) {
  *original=source;
  return DetourAttach(reinterpret_cast<void**>(original),replacement)==NO_ERROR;
}
static bool earlySystemModule(const wchar_t* name) {
  wchar_t actual[MAX_PATH]{},system[MAX_PATH]{};
  const HMODULE module=GetModuleHandleW(name);
  const UINT size=GetSystemDirectoryW(system,MAX_PATH);
  const DWORD length=module?GetModuleFileNameW(module,actual,MAX_PATH):0;
  return size && size<MAX_PATH && length && length<MAX_PATH &&
    CompareStringOrdinal(actual,int(size),system,int(size),TRUE)==CSTR_EQUAL && actual[size]==L'\\' &&
    CompareStringOrdinal(actual+size+1,-1,name,-1,TRUE)==CSTR_EQUAL;
}
static bool earlyConfigure(const SakuraClipboardEarly* input) {
  // This runs under the loader lock. user32/ole32 are static dependencies of
  // this DLL; never LoadLibrary, freeze other threads or wait for a worker here.
  // The primary thread is still suspended. The policy's Windows dependencies
  // initialize first; original application import DLLs initialize after us.
  // Enlist only this startup thread, as in Microsoft's Detours simple sample.
  // The whole transaction commits before returning.
  if(input->magic!=SakuraClipboardMagic || input->version!=SakuraClipboardVersion || input->reserved ||
      input->pid!=GetCurrentProcessId() || input->creationTime!=processCreation(GetCurrentProcess()) ||
      std::memcmp(input->build,SAKURA_CLIPBOARD_BUILD,65)!=0 ||
      std::find(input->section,input->section+192,L'\0')==input->section+192 ||
      !earlySystemModule(L"user32.dll") || !earlySystemModule(L"ole32.dll"))return false;
  section=OpenFileMappingW(FILE_MAP_ALL_ACCESS,FALSE,input->section);
  if(!section)return false;
  shared=static_cast<SakuraClipboardPolicy*>(MapViewOfFile(section,FILE_MAP_ALL_ACCESS,0,0,sizeof(SakuraClipboardPolicy)));
  if(!shared || shared->magic!=SakuraClipboardMagic || shared->version!=SakuraClipboardVersion ||
      shared->pid!=input->pid || shared->creationTime!=input->creationTime || shared->sequence&1 ||
      !shared->active || shared->flags>15 || shared->maxTextBytes<1024 || shared->maxTextBytes>1048576 ||
      std::memcmp(shared->build,SAKURA_CLIPBOARD_BUILD,65)!=0)return false;
  sectionName=input->section;
  if(!DetourRestoreAfterWith() || DetourTransactionBegin()!=NO_ERROR)return false;
  if(DetourUpdateThread(GetCurrentThread())!=NO_ERROR ||
      !earlyHook(&originalGet,&GetClipboardData,reinterpret_cast<void*>(&getData)) ||
      !earlyHook(&originalSet,&SetClipboardData,reinterpret_cast<void*>(&setData)) ||
      !earlyHook(&originalEmpty,&EmptyClipboard,reinterpret_cast<void*>(&empty)) ||
      !earlyHook(&originalAvailable,&IsClipboardFormatAvailable,reinterpret_cast<void*>(&available)) ||
      !earlyHook(&originalEnum,&EnumClipboardFormats,reinterpret_cast<void*>(&enumerate)) ||
      !earlyHook(&originalCount,&CountClipboardFormats,reinterpret_cast<void*>(&count)) ||
      !earlyHook(&originalPriority,&GetPriorityClipboardFormat,reinterpret_cast<void*>(&priority)) ||
      !earlyHook(&originalUpdated,&GetUpdatedClipboardFormats,reinterpret_cast<void*>(&updated)) ||
      !earlyHook(&originalOleGet,&OleGetClipboard,reinterpret_cast<void*>(&oleGet)) ||
      !earlyHook(&originalOleSet,&OleSetClipboard,reinterpret_cast<void*>(&oleSet)) ||
      !earlyHook(&originalOleFlush,&OleFlushClipboard,reinterpret_cast<void*>(&oleFlush))) {
    DetourTransactionAbort();return false;
  }
  if(DetourTransactionCommit()!=NO_ERROR)return false;
  InterlockedExchange(&shared->status,1);
  return true;
}
// Detours' first import refers to ordinal 1. The loader resolves this symbol;
// it does not execute it. The existing named configuration entry stays intact.
extern "C" __declspec(dllexport) void WINAPI SakuraClipboardEarlyOrdinal() {}
extern "C" __declspec(dllexport) DWORD WINAPI SakuraConfigureClipboard(void* pointer) {
  const auto input=static_cast<const SakuraClipboardConfigure*>(pointer);
  if (!input || input->magic!=SakuraClipboardMagic || input->version!=SakuraClipboardVersion ||
      std::find(input->section,input->section+192,L'\0')==input->section+192) return 1;
  AcquireSRWLockExclusive(&configureLock);
  DWORD answer=0;
  if (shared) answer=sectionName==input->section ? 0 : 2;
  else {
    section=OpenFileMappingW(FILE_MAP_ALL_ACCESS,FALSE,input->section);
    if (!section) answer=3;
    else {
      shared=static_cast<SakuraClipboardPolicy*>(MapViewOfFile(section,FILE_MAP_ALL_ACCESS,0,0,sizeof(SakuraClipboardPolicy)));
      if (!shared || shared->pid!=GetCurrentProcessId() || shared->creationTime!=processCreation(GetCurrentProcess()) ||
          shared->magic!=SakuraClipboardMagic || shared->version!=SakuraClipboardVersion ||
          std::memcmp(shared->build,SAKURA_CLIPBOARD_BUILD,65)!=0) answer=4;
      else {
        sectionName=input->section;
        if (!LoadLibraryExW(L"user32.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32) ||
            !LoadLibraryExW(L"ole32.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32) || MH_Initialize()!=MH_OK ||
            !hook(L"user32","GetClipboardData",reinterpret_cast<void*>(&getData),&originalGet) ||
            !hook(L"user32","SetClipboardData",reinterpret_cast<void*>(&setData),&originalSet) ||
            !hook(L"user32","EmptyClipboard",reinterpret_cast<void*>(&empty),&originalEmpty) ||
            !hook(L"user32","IsClipboardFormatAvailable",reinterpret_cast<void*>(&available),&originalAvailable) ||
            !hook(L"user32","EnumClipboardFormats",reinterpret_cast<void*>(&enumerate),&originalEnum) ||
            !hook(L"user32","CountClipboardFormats",reinterpret_cast<void*>(&count),&originalCount) ||
            !hook(L"user32","GetPriorityClipboardFormat",reinterpret_cast<void*>(&priority),&originalPriority) ||
            !hook(L"user32","GetUpdatedClipboardFormats",reinterpret_cast<void*>(&updated),&originalUpdated) ||
            !hook(L"ole32","OleGetClipboard",reinterpret_cast<void*>(&oleGet),&originalOleGet) ||
            !hook(L"ole32","OleSetClipboard",reinterpret_cast<void*>(&oleSet),&originalOleSet) ||
            !hook(L"ole32","OleFlushClipboard",reinterpret_cast<void*>(&oleFlush),&originalOleFlush) ||
            MH_EnableHook(MH_ALL_HOOKS)!=MH_OK) {
          MH_DisableHook(MH_ALL_HOOKS); MH_Uninitialize(); answer=5;
        }
        InterlockedExchange(&shared->status,answer ? 2 : 1);
      }
    }
    if (answer) {
      if (shared) UnmapViewOfFile(shared);
      if (section) CloseHandle(section);
      shared=nullptr; section=nullptr; sectionName.clear();
    }
  }
  ReleaseSRWLockExclusive(&configureLock);
  return answer;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID reserved) {
  if (reason==DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(instance);
    DWORD size=0;
    const auto input=static_cast<const SakuraClipboardEarly*>(DetourFindPayloadEx(SakuraClipboardEarlyGuid,&size));
    // A static startup import must have its durable-authorized payload. Keep
    // the later explicit LoadLibrary/configure path for normal running apps.
    if(reserved && !input)return FALSE;
    if(input) {
      bool ready=false;
      try {ready=size==sizeof(*input) && earlyConfigure(input);} catch(...) {}
      if(!ready) {
        if(shared)InterlockedExchange(&shared->status,2);
        // Refuse process initialization. Never run an original application DLL
        // with a missing rule or partial hook transaction, or fall back to the
        // later normal attachment path for a controlled child.
        return FALSE;
      }
    }
  }
  return TRUE;
}
