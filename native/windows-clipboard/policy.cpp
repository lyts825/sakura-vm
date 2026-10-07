/**
 * 模块职责（中文）：策略 DLL 统一拦截 Win32/OLE/控件和后代/Shell 创建。每次使用重读共享 seqlock，未知状态保守拒绝；早期 loader-lock 事务只使用静态系统依赖，普通附加还确认既有 GUI 控件。
 * Module responsibilities (English): The policy DLL guards Win32/OLE/controls and descendant/Shell creation. Reread shared seqlock per access, conservatively refuse unknown state, use only static system dependencies in early loader-lock transactions and confirm existing GUI controls during ordinary attachment.
 */
/** Windows 剪贴板策略 DLL，拦截 Win32、OLE 和控件操作；核实共享策略快照并在早期导入阶段接管后代创建。 */
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0a00
#endif
#include "protocol.h"
#include "early-import.h"
#include "control-system.h"
#include "vendor/minhook/include/MinHook.h"
#include <ole2.h>
#include <commctrl.h>
#include <richedit.h>
#include <tlhelp32.h>
#include <algorithm>
#include <cstring>
#include <cctype>
#include <climits>
#include <regex>
#include <string>
#include <vector>
#include <stdexcept>

// MinGW declares these helpers without dllimport. Keep the address used for
// dependency validation bound to the actual OS import, rather than our thunk.
/** 中文：声明系统子类化 API 的直接导入，来源核验使用实际 OS 导入地址而非 MinGW 本地 thunk。 English: Declare the direct OS subclass API import so provenance checks use its system address rather than a MinGW local thunk. 参数声明 / Declared parameters: HWND,SUBCLASSPROC,UINT_PTR,DWORD_PTR. */
extern "C" __declspec(dllimport) BOOL WINAPI SetWindowSubclass(HWND,SUBCLASSPROC,UINT_PTR,DWORD_PTR);

#ifndef SAKURA_CLIPBOARD_BUILD
#error The native build identity is required
#endif

static SakuraClipboardPolicy* shared = nullptr;
static HANDLE section = nullptr;
static std::wstring sectionName;
static SRWLOCK configureLock = SRWLOCK_INIT;
static HINSTANCE policyModule=nullptr;
static thread_local unsigned oleTransport=0;
struct OleTransportScope {
  /** 中文：增加线程内 OLE 元数据授权深度，仅在已经授权的 OLE 操作期间允许其内部传输格式。 English: Increase thread-local OLE metadata authorization depth only within an already-authorized OLE operation. */
  OleTransportScope() { ++oleTransport; }
  /** 中文：退出当前 OLE 授权层，避免元数据例外泄漏到随后普通 Win32 访问。 English: Leave the current authorization layer so metadata exceptions do not leak into subsequent ordinary Win32 access. */
  ~OleTransportScope() { --oleTransport; }
};
/** 中文：只在 OLE 授权层内识别两种注册的对象元数据格式，业务数据仍受 GuardedData 检查。 English: Recognize the two registered object metadata formats only inside authorized OLE scope; application data remains guarded. 参数声明 / Declared parameters: UINT format. */
static bool oleMetadata(UINT format) {
  if (!oleTransport || format<0xc000) return false;
  wchar_t name[64]{};
  return GetClipboardFormatNameW(format,name,64) &&
    (std::wcscmp(name,L"DataObject")==0 || std::wcscmp(name,L"Ole Private Data")==0);
}
struct Rule { bool active; uint32_t flags, maximum; };
/** 中文：最多重读 32 次偶数 seqlock 快照并核对 PID、创建时间、构建和大小上限；缺失或不稳定策略返回活动且禁止方向的保守规则。 English: Retry an even seqlock snapshot up to 32 times and verify PID, creation time, build and size limit; missing/unstable policy returns an active direction-denying rule. */
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
#include "descendant-policy.h"
/** 中文：原子增加对应复制或粘贴拒绝计数并设置 ACCESS_DENIED，不记录剪贴板内容。 English: Atomically increment the copy/paste denial counter and set ACCESS_DENIED without recording clipboard contents. 参数声明 / Declared parameters: bool copy. */
static void blocked(bool copy) {
  if (shared) InterlockedIncrement64(copy ? &shared->blockedCopy : &shared->blockedPaste);
  SetLastError(ERROR_ACCESS_DENIED);
}
/** 中文：依据给定快照判定复制或粘贴方向位，非活动策略允许方向。 English: Test copy/paste direction against the supplied snapshot, allowing it when policy is inactive. 参数声明 / Declared parameters: bool copy,const Rule& rule. */
static bool directionAllowed(bool copy,const Rule& rule) {
  return !rule.active || (rule.flags & (copy ? CopyAllowed : PasteAllowed));
}
/** 中文：读取当前策略并判定指定方向，供每次实际数据访问重新检查。 English: Read current policy and test the requested direction on each actual data access. 参数声明 / Declared parameters: bool copy. */
static bool direction(bool copy) { return directionAllowed(copy,current()); }
/** 中文：允许非活动策略、普通文本和 locale；其他格式需允许文件且未启用敏感内容过滤。 English: Allow inactive policy, plain text and locale; other formats require file permission with sensitive filtering disabled. 参数声明 / Declared parameters: UINT format, const Rule& rule. */
static bool formatAllowed(UINT format, const Rule& rule) {
  return !rule.active || format==CF_TEXT || format==CF_UNICODETEXT || format==CF_OEMTEXT ||
    format==CF_LOCALE || ((rule.flags & FilesAllowed) && !(rule.flags & Sensitive));
}
/** 中文：迭代扫描无界 JWT/URL 字段，避免大文本触发递归正则栈溢出，再用有限重复正则识别私钥、令牌和凭据。 English: Scan unbounded JWT/URL fields iteratively to avoid recursive regex stack exhaustion on large text, then use bounded patterns for keys/tokens/credentials. 参数声明 / Declared parameters: const std::string& text. */
static bool sensitive(const std::string& text) {
  /** 中文：识别 JWT 段允许的字母、数字和 URL-safe 字符，逐字节扫描不分配匹配栈。 English: Recognize letters, digits and URL-safe characters in JWT segments without allocating a recursive matching stack. 参数声明 / Declared parameters: unsigned char c. */
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
/** 中文：区分三种可解析文本格式，决定是否需要内容或流快照检查。 English: Identify the three parseable text formats that require content or stream-snapshot checks. 参数声明 / Declared parameters: UINT format. */
static bool plainFormat(UINT format) {
  return format==CF_TEXT || format==CF_UNICODETEXT || format==CF_OEMTEXT;
}
/** 中文：严格转换 UTF-16 为 UTF-8，按字节限制文本并按敏感标志检测；编码失败或超限拒绝。 English: Strictly convert UTF-16 to UTF-8, apply a byte limit and optional sensitive checks; reject conversion failure or overflow. 参数声明 / Declared parameters: const std::wstring& wide,const Rule& rule. */
static bool wideAllowed(const std::wstring& wide,const Rule& rule) {
  if(!rule.active)return true;
  const int count=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide.data(),int(wide.size()),nullptr,0,nullptr,nullptr);
  if((!wide.empty() && !count) || uint32_t(count)>rule.maximum)return false;
  std::string text(count,'\0');
  if(count && !WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide.data(),int(wide.size()),text.data(),count,nullptr,nullptr))return false;
  return !(rule.flags & Sensitive) || !sensitive(text);
}
/** 中文：有界锁定 HGLOBAL、寻找终止符并按 ANSI/OEM/Unicode 解码后核验文本；所有路径解锁，空延迟渲染占位在实际提供数据时再查。 English: Boundedly lock HGLOBAL, find a terminator and decode ANSI/OEM/Unicode text before validation; always unlock, checking delayed-render placeholders when data is supplied later. 参数声明 / Declared parameters: UINT format, HANDLE data, const Rule& rule. */
static bool contentAllowed(UINT format, HANDLE data, const Rule& rule) {
  if (!rule.active) return true;
  if (!formatAllowed(format,rule)) return false;
  if (!plainFormat(format)) return true;
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
    allowed=wideAllowed(wide,rule);
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
static decltype(&CreateWindowExW) originalCreateW=nullptr;
static decltype(&CreateWindowExA) originalCreateA=nullptr;
static decltype(&GetMessageW) originalMessageW=nullptr;
static decltype(&GetMessageA) originalMessageA=nullptr;
static decltype(&PeekMessageW) originalPeekW=nullptr;
static decltype(&PeekMessageA) originalPeekA=nullptr;
/** 中文：粘贴前检查方向和格式、取得原句柄后重读策略检查内容；只对授权 OLE 元数据绕过业务格式过滤。 English: Check paste direction/format before retrieval and reread policy afterward for content; only authorized OLE metadata bypasses application-format filtering. 参数声明 / Declared parameters: UINT format. */
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
/** 中文：复制写入前检查方向及实际内容，拒绝返回空句柄并计数；成功保持原 API 的所有权语义。 English: Check copy direction/content before writing, count denials and return null on refusal; successful calls retain original ownership semantics. 参数声明 / Declared parameters: UINT format,HANDLE data. */
static HANDLE WINAPI setData(UINT format,HANDLE data) {
  const auto rule=current();
  if (!direction(true) || (!oleMetadata(format) && !contentAllowed(format,data,rule))) { blocked(true); return nullptr; }
  return originalSet(format,data);
}
/** 中文：仅允许复制方向清空剪贴板，拒绝时保持原内容并设置错误。 English: Permit clipboard clearing only in the copy direction, retaining old contents and setting an error on denial. */
static BOOL WINAPI empty() {
  if (!direction(true)) { blocked(true); return FALSE; }
  return originalEmpty();
}
/** 中文：只暴露当前允许粘贴且允许格式的原可用性结果，不读取内容。 English: Expose original availability only for currently permitted paste formats without reading contents. 参数声明 / Declared parameters: UINT format. */
static BOOL WINAPI available(UINT format) {
  return direction(false) && formatAllowed(format,current()) ? originalAvailable(format) : FALSE;
}
/** 中文：沿原格式序列跳过不允许的格式，粘贴禁用或序列结束返回零。 English: Walk the original format sequence while hiding disallowed formats; return zero when paste is disabled or enumeration ends. 参数声明 / Declared parameters: UINT previous. */
static UINT WINAPI enumerate(UINT previous) {
  if (!direction(false)) return 0;
  const auto rule=current();
  UINT next=previous;
  while ((next=originalEnum(next))!=0) if (formatAllowed(next,rule)) return next;
  return 0;
}
/** 中文：活动策略下统计过滤后的格式，最多 65536 项；非活动状态委托原计数。 English: Count filtered formats under active policy with a 65536-item bound; delegate original counting when inactive. */
static int WINAPI count() {
  if (!direction(false)) return 0;
  if (!current().active) return originalCount();
  int result=0; UINT next=0;
  while ((next=enumerate(next))!=0 && result<65536) ++result;
  return result;
}
/** 中文：校验有界格式数组并按调用者顺序选择允许的可用格式，保留原 API 的零与负一结果含义。 English: Validate a bounded format array and choose permitted available formats in caller order, retaining the API meanings of zero and minus one. 参数声明 / Declared parameters: UINT* formats,int length. */
static int WINAPI priority(UINT* formats,int length) {
  if (!direction(false)) return 0;
  if (!current().active) return originalPriority(formats,length);
  if (!formats || length<0 || length>65536) { SetLastError(ERROR_INVALID_PARAMETER); return 0; }
  for (int i=0;i<length;++i) if (available(formats[i])) return int(formats[i]);
  return count() ? -1 : 0;
}
/** 中文：先取得完整更新列表再过滤，输出所需数量；调用者缓冲区不足返回 INSUFFICIENT_BUFFER，禁止粘贴时拒绝。 English: Retrieve the complete updated list before filtering and report required count; return INSUFFICIENT_BUFFER for short output or deny disabled paste. 参数声明 / Declared parameters: PUINT formats,UINT length,PUINT filled. */
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

// Standard edit controls may empty the clipboard in user32's internal code,
// then delete cut text even when SetClipboardData is refused. Subclass them on
// their own GUI thread before the ordinary control copy/keyboard handler runs.
// This never patches class procedures or another process's windows.
static constexpr UINT_PTR controlSubclassId=0x53434c50;
static constexpr LRESULT controlConfirmation=0x53434c50;
static UINT controlProbeMessage=0;
static thread_local HHOOK controlThreadHook=nullptr;
static thread_local bool preparingControlThread=false;
static thread_local bool installingControl=false;
struct ControlCreation { bool ansi;const void* type;ControlCreation* previous; };
static thread_local ControlCreation* controlCreation=nullptr;
struct ControlCreationScope {
  ControlCreation frame;
  /** 中文：保存并压入本线程当前 ANSI/Unicode 创建上下文，以辨认内部 A→W thunk 和独立子控件。 English: Push the thread's ANSI/Unicode creation context to distinguish an internal A-to-W thunk from independent child controls. 参数声明 / Declared parameters: bool ansi,const void* type. */
  ControlCreationScope(bool ansi,const void* type):frame{ansi,type,controlCreation}{controlCreation=&frame;}
  /** 中文：恢复上一层控件创建上下文，支持嵌套创建并避免线程局部状态泄漏。 English: Restore the previous creation context for nesting without leaking thread-local state. */
  ~ControlCreationScope(){controlCreation=frame.previous;}
};
/** 中文：仅在 ANSI 创建层内比较同一类名或 atom，识别仍未最终确定编码的内部宽字符创建。 English: Compare the same class name/atom only in an ANSI creation scope to identify an internal wide creation whose encoding is not finalized. 参数声明 / Declared parameters: LPCWSTR type. */
static bool ansiCreationThunk(LPCWSTR type) {
  if(!controlCreation || !controlCreation->ansi)return false;
  const auto narrow=static_cast<LPCSTR>(controlCreation->type);
  const uintptr_t first=reinterpret_cast<uintptr_t>(narrow),second=reinterpret_cast<uintptr_t>(type);
  if(first<=0xffff || second<=0xffff)return first==second;
  unsigned length=0;while(length<256 && narrow[length])++length;
  if(length==256)return false;
  wchar_t name[256]{};
  const int count=MultiByteToWideChar(CP_ACP,0,narrow,int(length),name,255);
  return count>0 && CompareStringOrdinal(name,count,type,-1,TRUE)==CSTR_EQUAL;
}
static constexpr const wchar_t* ansiControlProperty=L"SakuraClipboard.Ansi." SAKURA_CLIPBOARD_BUILD;
struct AnsiControl {WNDPROC original;};
/** 中文：只识别本进程 Edit、RichEdit 和对应 WinForms 类，返回普通或富文本类别，其他窗口返回零。 English: Identify only this process's Edit/RichEdit and corresponding WinForms classes, returning plain/rich kind or zero for other windows. 参数声明 / Declared parameters: HWND window. */
static int controlKind(HWND window) {
  DWORD pid=0;GetWindowThreadProcessId(window,&pid);
  if(pid!=GetCurrentProcessId())return 0;
  wchar_t name[64]{};if(!GetClassNameW(window,name,64))return 0;
  if(CompareStringOrdinal(name,-1,L"Edit",-1,TRUE)==CSTR_EQUAL)return 1;
  /** 中文：按大小写不敏感的 WindowsForms10 类名前缀识别指定控件类型。 English: Identify a requested control type by its case-insensitive WindowsForms10 class prefix. 参数声明 / Declared parameters: const wchar_t* name,const wchar_t* type. */
  const auto forms=[](const wchar_t* name,const wchar_t* type){
    const std::wstring prefix=L"WindowsForms10."+std::wstring(type)+L".";
    return std::wcslen(name)>=prefix.size() && CompareStringOrdinal(name,int(prefix.size()),prefix.c_str(),int(prefix.size()),TRUE)==CSTR_EQUAL;
  };
  if(forms(name,L"EDIT"))return 1;
  for(const auto type:{L"RichEdit",L"RichEdit20A",L"RichEdit20W",L"RICHEDIT50W"})
    if(CompareStringOrdinal(name,-1,type,-1,TRUE)==CSTR_EQUAL || forms(name,type))return 2;
  return 0;
}
/** 中文：按控件类型读取精确选区，限制分配并正确处理 RichEdit 终止标记及 ANSI 编码；普通 Edit 只检查选中的切片。 English: Read the exact selection by control type, bound allocations and handle RichEdit terminal markers/ANSI encoding; validate only the selected slice for ordinary Edit. 参数声明 / Declared parameters: HWND window,int kind,std::wstring& text,const Rule& rule. */
static bool selectedControlText(HWND window,int kind,std::wstring& text,const Rule& rule) {
  LONG first=0,last=0;
  if(kind==2){
    CHARRANGE selection{};
    SendMessageW(window,EM_EXGETSEL,0,reinterpret_cast<LPARAM>(&selection));
    first=selection.cpMin;last=selection.cpMax;
  }else {
    DWORD begin=0,end=0;SendMessageW(window,EM_GETSEL,reinterpret_cast<WPARAM>(&begin),reinterpret_cast<LPARAM>(&end));
    if(begin>INT_MAX || end>INT_MAX)return false;first=LONG(begin);last=LONG(end);
  }
  // RichEdit's select-all range includes its terminal document marker, which
  // is absent from EM_GETSELTEXT. Inspect the returned text's exact UTF-8 size.
  if(first<0 || last<first || uint32_t(last-first)>rule.maximum+(kind==2?1u:0u))return false;
  if(last==first){text.clear();return true;}
  if(kind==2){
    if(!IsWindowUnicode(window)){
      std::vector<char> bytes(size_t(last-first)*4+4,0);
      const LRESULT count=SendMessageA(window,EM_GETSELTEXT,0,reinterpret_cast<LPARAM>(bytes.data()));
      const auto end=std::find(bytes.begin(),bytes.end(),'\0');
      if(count<0 || end==bytes.end())return false;
      const int length=int(end-bytes.begin());
      const int characters=MultiByteToWideChar(CP_ACP,0,bytes.data(),length,nullptr,0);
      if(length && !characters)return false;
      text.resize(size_t(characters));
      return !characters || MultiByteToWideChar(CP_ACP,0,bytes.data(),length,text.data(),characters)==characters;
    }
    text.assign(size_t(last-first)+1,L'\0');
    const LRESULT count=SendMessageW(window,EM_GETSELTEXT,0,reinterpret_cast<LPARAM>(text.data()));
    if(count<0 || size_t(count)>=text.size())return false;
    text.resize(size_t(count));return true;
  }
  // The standard EDIT API exposes the complete buffer. Bound its allocation;
  // only the selected slice is subject to the clipboard's UTF-8 limit.
  const int length=GetWindowTextLengthW(window);
  if(length<last || length>16*1024*1024)return false;
  std::wstring all(size_t(length)+1,L'\0');
  if(GetWindowTextW(window,all.data(),int(all.size()))!=length)return false;
  text=all.substr(size_t(first),size_t(last-first));return true;
}
/** 中文：识别复制、剪切消息和常用键盘组合，排除 Alt 组合并保留其他输入。 English: Recognize copy/cut messages and common key combinations while excluding Alt combinations and retaining other input. 参数声明 / Declared parameters: UINT message,WPARAM key. */
static bool controlCopyRequest(UINT message,WPARAM key) {
  if(message==WM_COPY || message==WM_CUT)return true;
  if(message==WM_CHAR)return key==3 || key==24;
  if(message!=WM_KEYDOWN)return false;
  const bool control=(GetKeyState(VK_CONTROL)&0x8000)!=0,shift=(GetKeyState(VK_SHIFT)&0x8000)!=0;
  if(GetKeyState(VK_MENU)&0x8000)return false;
  return (control && (key=='C' || key=='X' || key==VK_INSERT)) || (!control && shift && key==VK_DELETE);
}
/** 中文：在控件默认处理剪切前核验选中文本及最新策略，避免 user32 已清空剪贴板或删除文本后才拒绝。 English: Validate selection/latest policy before default cut processing so refusal precedes user32 clearing the clipboard or deleting text. 参数声明 / Declared parameters: HWND window,UINT message,WPARAM a. */
static bool allowControlMessage(HWND window,UINT message,WPARAM a) {
  if(controlCopyRequest(message,a)) {
    bool allowed=false;
    try {
      const auto rule=current();
      if(!rule.active)allowed=true;
      else if(rule.flags&CopyAllowed){
        std::wstring text;
        allowed=selectedControlText(window,controlKind(window),text,rule) && direction(true) && wideAllowed(text,current());
      }
    }catch(...){allowed=false;}
    if(!allowed){blocked(true);return false;}
  }
  return true;
}
/** 中文：响应安装探针、在销毁时移除子类，其他消息通过策略检查后交给 DefSubclassProc。 English: Respond to installation probes, remove the subclass on destruction and forward other messages to DefSubclassProc after policy checks. 参数声明 / Declared parameters: HWND window,UINT message,WPARAM a,LPARAM b,UINT_PTR id,DWORD_PTR. */
static LRESULT CALLBACK controlProcedure(HWND window,UINT message,WPARAM a,LPARAM b,UINT_PTR id,DWORD_PTR) {
  if(controlProbeMessage && message==controlProbeMessage)return controlConfirmation;
  if(message==WM_NCDESTROY)RemoveWindowSubclass(window,controlProcedure,id);
  else if(!allowControlMessage(window,message,a))return 0;
  return DefSubclassProc(window,message,a,b);
}
/** 中文：保持原 ANSI WNDPROC 编码链，先执行复制检查；销毁时移除属性、调用原过程并释放上下文。 English: Retain the original ANSI WNDPROC encoding chain with copy checks; on destruction remove the property, call the original procedure and free context. 参数声明 / Declared parameters: HWND window,UINT message,WPARAM a,LPARAM b. */
static LRESULT CALLBACK ansiControlProcedure(HWND window,UINT message,WPARAM a,LPARAM b) {
  auto context=reinterpret_cast<AnsiControl*>(GetPropW(window,ansiControlProperty));
  if(!context)return DefWindowProcA(window,message,a,b);
  if(controlProbeMessage && message==controlProbeMessage)return controlConfirmation;
  if(message==WM_NCDESTROY){
    const WNDPROC original=context->original;RemovePropW(window,ansiControlProperty);
    const LRESULT result=CallWindowProcA(original,window,message,a,b);delete context;return result;
  }
  if(!allowControlMessage(window,message,a))return 0;
  return CallWindowProcA(context->original,window,message,a,b);
}
/** 中文：只在窗口所属线程安装保护并防止重入；Unicode 使用公开子类 API，ANSI 保留原编码链，失败使共享状态不就绪。 English: Install only on the window's owning thread with a reentry guard; Unicode uses subclass APIs, ANSI retains its encoding chain and failure marks shared status unready. 参数声明 / Declared parameters: HWND window. */
static bool installControl(HWND window) {
  if(!controlKind(window))return true;
  if(GetWindowThreadProcessId(window,nullptr)!=GetCurrentThreadId())return false;
  if(installingControl)return false;
  installingControl=true;
  // SetWindowSubclass is idempotent for this procedure/id pair. Do not import
  // GetWindowSubclass: Windows' default v5 common-controls image exports only
  // the other documented subclass helpers by name; v6 supports all four.
  bool installed=false;
  if(GetPropW(window,ansiControlProperty))installed=true;
  else if(IsWindowUnicode(window))installed=SetWindowSubclass(window,controlProcedure,controlSubclassId,0)!=FALSE;
  else {
    // A Unicode common-controls helper changes an ANSI window's message
    // encoding. Keep its original ANSI chain using the documented raw API;
    // this entire installation and destruction run on its owning thread.
    auto context=new(std::nothrow) AnsiControl{reinterpret_cast<WNDPROC>(GetWindowLongPtrA(window,GWLP_WNDPROC))};
    if(context && context->original && SetPropW(window,ansiControlProperty,context)){
      SetLastError(0);
      const auto previous=reinterpret_cast<WNDPROC>(SetWindowLongPtrA(window,GWLP_WNDPROC,reinterpret_cast<LONG_PTR>(&ansiControlProcedure)));
      if(previous){context->original=previous;installed=true;}
      else {SetWindowLongPtrA(window,GWLP_WNDPROC,reinterpret_cast<LONG_PTR>(context->original));RemovePropW(window,ansiControlProperty);delete context;}
    }else delete context;
  }
  if(!installed && shared)InterlockedExchange(&shared->status,2);
  installingControl=false;
  return installed;
}
/** 中文：普通窗口消息到达所属 GUI 线程时尝试安装控件保护，跳过创建/销毁阶段并继续钩子链。 English: Attempt protection when ordinary window messages reach their GUI thread, skip creation/destruction phases and continue the hook chain. 参数声明 / Declared parameters: int code,WPARAM a,LPARAM b. */
static LRESULT CALLBACK controlMessageHook(int code,WPARAM a,LPARAM b) {
  if(code>=0 && b){
    const auto message=reinterpret_cast<const CWPSTRUCT*>(b);
    if(!controlCreation && message->message!=WM_NCCREATE && message->message!=WM_NCDESTROY && message->message!=WM_DESTROY)
      installControl(message->hwnd);
  }
  return CallNextHookEx(nullptr,code,a,b);
}
/** 中文：普通执行中先建立消息队列再安装本线程消息钩子；重入或已安装直接返回，不在 loader lock 中调用。 English: During ordinary execution create the message queue before installing a thread hook; skip reentry/already-installed cases and never call under loader lock. */
static void prepareControlThread() {
  if(preparingControlThread || controlThreadHook)return;
  preparingControlThread=true;
  // Called only in ordinary execution, never from earlyConfigure/DllMain.
  // A first PeekMessage gives a new GUI thread its queue before the hook.
  MSG message{};originalPeekW(&message,nullptr,0,0,PM_NOREMOVE);
  controlThreadHook=SetWindowsHookExW(WH_CALLWNDPROC,controlMessageHook,policyModule,GetCurrentThreadId());
  preparingControlThread=false;
}
/** 中文：包围原宽字符创建以记录上下文；同类 ANSI 内部 thunk 延迟安装，其他受保护控件安装失败即销毁并拒绝。 English: Record context around wide creation; defer a same-class ANSI thunk, otherwise destroy/refuse a protected control whose installation fails. 参数声明 / Declared parameters: DWORD ex,LPCWSTR type,LPCWSTR text,DWORD style,int x,int y,int width,int height,HWND parent,HMENU menu,HINSTANCE instance,LPVOID param. */
static HWND WINAPI createControlW(DWORD ex,LPCWSTR type,LPCWSTR text,DWORD style,int x,int y,int width,int height,HWND parent,HMENU menu,HINSTANCE instance,LPVOID param) {
  // A's internal W thunk has not yet fixed the returned window's ANSI message
  // encoding. Defer only that same class, not independent child controls
  // created while a custom parent's WM_CREATE is still on the stack.
  const bool deferred=ansiCreationThunk(type);HWND window=nullptr;
  {ControlCreationScope creating(false,type);window=originalCreateW(ex,type,text,style,x,y,width,height,parent,menu,instance,param);}
  if(window && !deferred && !installControl(window)){DestroyWindow(window);SetLastError(ERROR_ACCESS_DENIED);return nullptr;}return window;
}
/** 中文：记录 ANSI 创建上下文并在编码已确定的返回窗口上安装保护，安装失败销毁窗口。 English: Record ANSI creation context and protect the returned window after encoding is finalized, destroying it on installation failure. 参数声明 / Declared parameters: DWORD ex,LPCSTR type,LPCSTR text,DWORD style,int x,int y,int width,int height,HWND parent,HMENU menu,HINSTANCE instance,LPVOID param. */
static HWND WINAPI createControlA(DWORD ex,LPCSTR type,LPCSTR text,DWORD style,int x,int y,int width,int height,HWND parent,HMENU menu,HINSTANCE instance,LPVOID param) {
  HWND window=nullptr;
  {ControlCreationScope creating(true,type);window=originalCreateA(ex,type,text,style,x,y,width,height,parent,menu,instance,param);}
  if(window && !installControl(window)){DestroyWindow(window);SetLastError(ERROR_ACCESS_DENIED);return nullptr;}return window;
}
/** 中文：准备当前 GUI 线程保护后委托宽字符 GetMessage，保持消息过滤参数和返回值。 English: Prepare GUI-thread protection then delegate wide GetMessage with its filters and return value intact. 参数声明 / Declared parameters: LPMSG message,HWND window,UINT first,UINT last. */
static BOOL WINAPI messageControlW(LPMSG message,HWND window,UINT first,UINT last) {prepareControlThread();return originalMessageW(message,window,first,last);}
/** 中文：准备当前 GUI 线程保护后委托 ANSI GetMessage，保持编码和阻塞语义。 English: Prepare GUI-thread protection then delegate ANSI GetMessage with encoding/blocking semantics intact. 参数声明 / Declared parameters: LPMSG message,HWND window,UINT first,UINT last. */
static BOOL WINAPI messageControlA(LPMSG message,HWND window,UINT first,UINT last) {prepareControlThread();return originalMessageA(message,window,first,last);}
/** 中文：准备当前 GUI 线程保护后委托宽字符 PeekMessage，保留 remove 标志。 English: Prepare GUI-thread protection then delegate wide PeekMessage while retaining the remove flags. 参数声明 / Declared parameters: LPMSG message,HWND window,UINT first,UINT last,UINT remove. */
static BOOL WINAPI peekControlW(LPMSG message,HWND window,UINT first,UINT last,UINT remove) {prepareControlThread();return originalPeekW(message,window,first,last,remove);}
/** 中文：准备当前 GUI 线程保护后委托 ANSI PeekMessage，保留消息与 remove 参数。 English: Prepare GUI-thread protection then delegate ANSI PeekMessage with its message/remove parameters intact. 参数声明 / Declared parameters: LPMSG message,HWND window,UINT first,UINT last,UINT remove. */
static BOOL WINAPI peekControlA(LPMSG message,HWND window,UINT first,UINT last,UINT remove) {prepareControlThread();return originalPeekA(message,window,first,last,remove);}
struct ControlAttachment {std::vector<HWND> windows;bool ready=true;};
/** 中文：将可保护控件加入收集结果，继续枚举以便完整确认安装。 English: Collect protectable controls and continue enumeration for complete installation confirmation. 参数声明 / Declared parameters: HWND window,LPARAM pointer. */
static BOOL CALLBACK collectControl(HWND window,LPARAM pointer) {
  if(controlKind(window))reinterpret_cast<ControlAttachment*>(pointer)->windows.push_back(window);
  return TRUE;
}
/** 中文：收集线程顶层窗口及其子控件，回调继续枚举。 English: Collect a thread's top-level window and descendants while continuing enumeration. 参数声明 / Declared parameters: HWND window,LPARAM pointer. */
static BOOL CALLBACK collectThreadWindow(HWND window,LPARAM pointer) {
  collectControl(window,pointer);EnumChildWindows(window,collectControl,pointer);return TRUE;
}
/** 中文：普通配置阶段逐 GUI 线程收集窗口，以临时钩子和有界探针确认保护；挂起或未确认的存活窗口不能报告就绪。 English: Collect windows per GUI thread during ordinary configuration and confirm protection via temporary hooks/bounded probes; hung or unconfirmed live windows prevent readiness. */
static bool attachExistingControls() {
  // The regular configure export runs outside the loader lock. Existing GUI
  // windows are reached with a temporary thread hook and confirmed by their
  // installed subclass. Never report ready after a hung/unconfirmed control.
  controlProbeMessage=RegisterWindowMessageW(L"SakuraClipboard.Controls." SAKURA_CLIPBOARD_BUILD);
  if(!controlProbeMessage)return false;
  const HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD,0);
  if(snapshot==INVALID_HANDLE_VALUE)return false;
  ControlAttachment controls;
  THREADENTRY32 entry{};entry.dwSize=sizeof(entry);
  if(Thread32First(snapshot,&entry))do {
    if(entry.th32OwnerProcessID==GetCurrentProcessId())EnumThreadWindows(entry.th32ThreadID,collectThreadWindow,reinterpret_cast<LPARAM>(&controls));
  }while(Thread32Next(snapshot,&entry));
  CloseHandle(snapshot);
  for(HWND window=FindWindowExW(HWND_MESSAGE,nullptr,nullptr,nullptr);window;
      window=FindWindowExW(HWND_MESSAGE,window,nullptr,nullptr)){
    DWORD pid=0;GetWindowThreadProcessId(window,&pid);
    if(pid==GetCurrentProcessId())collectThreadWindow(window,reinterpret_cast<LPARAM>(&controls));
  }
  for(const HWND window:controls.windows){
    DWORD pid=0;const DWORD thread=GetWindowThreadProcessId(window,&pid);
    if(!thread || pid!=GetCurrentProcessId())continue; // Destroyed before attachment.
    const HHOOK hook=SetWindowsHookExW(WH_CALLWNDPROC,controlMessageHook,policyModule,thread);
    if(!hook){controls.ready=false;break;}
    DWORD_PTR reply=0;
    const bool activated=SendMessageTimeoutW(window,WM_NULL,0,0,SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&reply)!=0;
    reply=0;
    const bool confirmed=activated && SendMessageTimeoutW(window,controlProbeMessage,0,0,SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&reply) && reply==DWORD_PTR(controlConfirmation);
    UnhookWindowsHookEx(hook);
    if(!confirmed && IsWindow(window)){controls.ready=false;break;}
  }
  return controls.ready;
}

#include "ole-text-stream.h"

// OLE uses cached IDataObject proxies as well as user32 calls. Check data at each
// GetData, including a proxy obtained before a later policy tightening.
class GuardedFormats final:public IEnumFORMATETC {
  LONG references=1;
  IEnumFORMATETC* source;
  bool copy;
public:
  /** 中文：保留源格式枚举器引用并绑定复制/粘贴方向，使每次枚举依据最新策略过滤。 English: Retain the source enumerator and bind its copy/paste direction so each enumeration uses current policy. 参数声明 / Declared parameters: IEnumFORMATETC* value,bool copying. */
  GuardedFormats(IEnumFORMATETC* value,bool copying):source(value),copy(copying) { source->AddRef(); }
  /** 中文：释放持有的源枚举器引用，不释放已经交付给调用者的 FORMATETC。 English: Release the retained source enumerator without releasing FORMATETC entries already delivered to callers. */
  ~GuardedFormats() { source->Release(); }
  /** 中文：只提供声明的 IUnknown/本类 COM 接口，清空输出并在成功时 AddRef；空输出或未知 IID 返回对应 HRESULT。 English: Expose only declared IUnknown/class COM interfaces, clear output and AddRef on success; null output/unknown IID return corresponding HRESULTs. 参数声明 / Declared parameters: REFIID id,void** out. */
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
    if(!out)return E_POINTER;
    *out=nullptr;
    if(id!=IID_IUnknown && id!=IID_IEnumFORMATETC)return E_NOINTERFACE;
    *out=static_cast<IEnumFORMATETC*>(this);AddRef();return S_OK;
  }
  /** 中文：原子增加包装对象 COM 引用计数并返回新计数，调用者需与 Release 配对。 English: Atomically increase the wrapper's COM reference count and return it, requiring caller pairing with Release. */
  ULONG STDMETHODCALLTYPE AddRef() override {return ULONG(InterlockedIncrement(&references));}
  /** 中文：原子减少 COM 引用计数，归零即 delete 当前对象并返回剩余计数。 English: Atomically decrease COM references, delete this object at zero and return the remaining count. */
  ULONG STDMETHODCALLTYPE Release() override {const LONG next=InterlockedDecrement(&references);if(!next)delete this;return ULONG(next);}
  /** 中文：有界逐项过滤最新策略，不允许的 FORMATETC 释放目标设备内存；限制文本 medium 位并按实际交付数返回 S_OK/S_FALSE。 English: Boundedly filter entries under current policy, free rejected target-device memory, restrict text medium bits and return S_OK/S_FALSE by delivered count. 参数声明 / Declared parameters: ULONG length,FORMATETC* out,ULONG* fetched. */
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
      if(directionAllowed(copy,rule) && formatAllowed(value.cfFormat,rule) && (!rule.active || !plain || (value.tymed&(TYMED_HGLOBAL|TYMED_ISTREAM)))){
        if(rule.active && plain)value.tymed&=TYMED_HGLOBAL|TYMED_ISTREAM;
        out[accepted++]=value;
      }else if(value.ptd)CoTaskMemFree(value.ptd);
    }
    if(fetched)*fetched=accepted;
    return accepted==length?S_OK:S_FALSE;
  }
  /** 中文：通过受保护 Next 跳过允许项并释放临时目标设备，避免绕过过滤推进原枚举器。 English: Skip permitted entries through guarded Next and free temporary target devices rather than bypassing filtering on the source. 参数声明 / Declared parameters: ULONG count. */
  HRESULT STDMETHODCALLTYPE Skip(ULONG count) override {
    if(count>65536)return E_INVALIDARG;
    for(ULONG i=0;i<count;++i){FORMATETC value{};ULONG fetched=0;const HRESULT answer=Next(1,&value,&fetched);
      if(value.ptd)CoTaskMemFree(value.ptd);if(answer!=S_OK)return answer;}
    return S_OK;
  }
  /** 中文：委托原枚举器重置游标，后续读取继续执行策略过滤。 English: Reset the source cursor while subsequent reads remain policy-filtered. */
  HRESULT STDMETHODCALLTYPE Reset() override {return source->Reset();}
  /** 中文：克隆原游标并包装相同方向，失败释放临时引用并报告 HRESULT/内存不足。 English: Clone the source cursor with the same directional guard, releasing temporary references on HRESULT/allocation failure. 参数声明 / Declared parameters: IEnumFORMATETC** out. */
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
  /** 中文：保留源 IDataObject 引用并绑定访问方向，缓存代理每次访问仍检查最新策略。 English: Retain source IDataObject and bind direction so cached proxies still check current policy on every access. 参数声明 / Declared parameters: IDataObject* value,bool copying. */
  GuardedData(IDataObject* value,bool copying):source(value),copy(copying) { source->AddRef(); }
  /** 中文：释放源对象引用，COM 引用计数归零后才销毁包装器。 English: Release the source reference when the wrapper is destroyed after its COM reference count reaches zero. */
  ~GuardedData() { source->Release(); }
  /** 中文：只提供声明的 IUnknown/本类 COM 接口，清空输出并在成功时 AddRef；空输出或未知 IID 返回对应 HRESULT。 English: Expose only declared IUnknown/class COM interfaces, clear output and AddRef on success; null output/unknown IID return corresponding HRESULTs. 参数声明 / Declared parameters: REFIID id,void** out. */
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
    if (!out) return E_POINTER;
    *out=nullptr;
    if (id!=IID_IUnknown && id!=IID_IDataObject) return E_NOINTERFACE;
    *out=static_cast<IDataObject*>(this); AddRef(); return S_OK;
  }
  /** 中文：原子增加包装对象 COM 引用计数并返回新计数，调用者需与 Release 配对。 English: Atomically increase the wrapper's COM reference count and return it, requiring caller pairing with Release. */
  ULONG STDMETHODCALLTYPE AddRef() override { return ULONG(InterlockedIncrement(&references)); }
  /** 中文：原子减少 COM 引用计数，归零即 delete 当前对象并返回剩余计数。 English: Atomically decrease COM references, delete this object at zero and return the remaining count. */
  ULONG STDMETHODCALLTYPE Release() override {
    const LONG remaining=InterlockedDecrement(&references);
    if (!remaining) delete this;
    return ULONG(remaining);
  }
  /** 中文：检查方向/格式后取得 medium 并重读规则；文本流复制到私有字节，先释放可变提供者再检查，失败释放 medium 不向消费者交付。 English: Check direction/format, retrieve a medium and reread policy; snapshot text streams privately, release mutable providers before checking and free refused media instead of delivering them. 参数声明 / Declared parameters: FORMATETC* format,STGMEDIUM* result. */
  HRESULT STDMETHODCALLTYPE GetData(FORMATETC* format,STGMEDIUM* result) override {
    if (!format || !result) return E_POINTER;
    *result={};
    auto rule=current();
    if (!directionAllowed(copy,rule) || !formatAllowed(format->cfFormat,rule)) { blocked(copy); return E_ACCESSDENIED; }
    FORMATETC request=*format;
    if(rule.active && plainFormat(request.cfFormat)){
      request.tymed&=TYMED_HGLOBAL|TYMED_ISTREAM;
      if(!request.tymed)return DV_E_TYMED;
    }
    STGMEDIUM data{};
    const HRESULT answer=source->GetData(&request,&data);
    if (FAILED(answer)) return answer;
    rule=current();
    if(rule.active && !(request.tymed&data.tymed)){
      ReleaseStgMedium(&data);blocked(copy);return DV_E_TYMED;
    }
    if(rule.active && plainFormat(format->cfFormat) && data.tymed==TYMED_ISTREAM){
      ClipboardTextStream snapshot;
      const HRESULT captured=snapshot.capture(data.pstm,rule.maximum);
      // The original provider may mutate its stream after GetData or while
      // releasing it. Only the private checked bytes reach the consumer.
      ReleaseStgMedium(&data);data={};
      const auto latest=current();
      if(FAILED(captured) || !directionAllowed(copy,latest) || !snapshot.allowed(format->cfFormat,latest)){
        blocked(copy);return E_ACCESSDENIED;
      }
      return snapshot.releaseTo(result);
    }
    if (!clipboardMediumAllowed(format->cfFormat,data,copy)) {
      ReleaseStgMedium(&data); blocked(copy); return E_ACCESSDENIED;
    }
    *result=data; return answer;
  }
  /** 中文：先在自有临时 medium 中渲染核验，再写调用者空间；流保持当前游标、不 seek/截断/接管所有权，短写或容量不足以 HRESULT 返回。 English: Render/check in an owned temporary before writing caller storage; streams retain their cursor without seeking/truncation/ownership transfer, reporting short writes/capacity errors via HRESULT. 参数声明 / Declared parameters: FORMATETC* format,STGMEDIUM* result. */
  HRESULT STDMETHODCALLTYPE GetDataHere(FORMATETC* format,STGMEDIUM* result) override {
    if (!current().active) return source->GetDataHere(format,result);
    if (!format || !result) return E_POINTER;
    const bool stream=format->tymed==TYMED_ISTREAM && result->tymed==TYMED_ISTREAM &&
      result->pstm && plainFormat(format->cfFormat);
    if (result->pUnkForRelease || (!stream &&
        (format->tymed!=TYMED_HGLOBAL || result->tymed!=TYMED_HGLOBAL || !result->hGlobal)))
      return DV_E_TYMED;
    // Render into an owned temporary and inspect it before touching the
    // caller's buffer; never delegate a direct write to an unguarded source.
    STGMEDIUM data{};
    const HRESULT answer=GetData(format,&data);
    if (FAILED(answer)) return answer;
    if(stream){
      ClipboardTextStream snapshot;
      const auto rule=current();
      const HRESULT captured=data.tymed==TYMED_ISTREAM?
        snapshot.capture(data.pstm,rule.active?rule.maximum:1048576):DV_E_TYMED;
      ReleaseStgMedium(&data);
      const auto latest=current();
      if(FAILED(captured) || !directionAllowed(copy,latest) || !snapshot.allowed(format->cfFormat,latest)){
        blocked(copy);return E_ACCESSDENIED;
      }
      const void* bytes=GlobalLock(snapshot.bytes);
      if(!bytes)return E_OUTOFMEMORY;
      ULONG written=0;
      // GetDataHere appends at the caller's current cursor. Do not seek,
      // truncate, replace, or take ownership of the caller's stream.
      const HRESULT copied=result->pstm->Write(bytes,snapshot.length,&written);
      GlobalUnlock(snapshot.bytes);
      return FAILED(copied)?copied:written==snapshot.length?S_OK:STG_E_MEDIUMFULL;
    }
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
  /** 中文：在询问源能力前过滤方向和格式，文本只允许 HGLOBAL/IStream medium 位，不读取内容。 English: Filter direction/format before asking source capabilities, restricting text to HGLOBAL/IStream bits without reading contents. 参数声明 / Declared parameters: FORMATETC* format. */
  HRESULT STDMETHODCALLTYPE QueryGetData(FORMATETC* format) override {
    if (!format) return E_POINTER;
    const auto rule=current();
    if (!directionAllowed(copy,rule) || !formatAllowed(format->cfFormat,rule)) return E_ACCESSDENIED;
    FORMATETC request=*format;
    if(rule.active && plainFormat(request.cfFormat)){
      request.tymed&=TYMED_HGLOBAL|TYMED_ISTREAM;
      if(!request.tymed)return DV_E_TYMED;
    }
    return source->QueryGetData(&request);
  }
  /** 中文：保持源对象的标准格式转换契约；实际数据获取仍经 GetData 的检查。 English: Preserve source canonical-format conversion; actual retrieval still passes through GetData checks. 参数声明 / Declared parameters: FORMATETC* a,FORMATETC* b. */
  HRESULT STDMETHODCALLTYPE GetCanonicalFormatEtc(FORMATETC* a,FORMATETC* b) override { return source->GetCanonicalFormatEtc(a,b); }
  /** 中文：写入文本流使用已检查的私有快照；只有源成功接收且 release 为真才转移原 medium 所有权，失败释放快照并保留调用者原值。 English: Write text streams through checked private snapshots; transfer original ownership only on successful source acceptance with release=true, otherwise free snapshots and retain the caller's medium. 参数声明 / Declared parameters: FORMATETC* format,STGMEDIUM* value,BOOL release. */
  HRESULT STDMETHODCALLTYPE SetData(FORMATETC* format,STGMEDIUM* value,BOOL release) override {
    if (!format || !value) return E_POINTER;
    if(current().active && value->tymed==TYMED_ISTREAM && plainFormat(format->cfFormat)){
      if(format->tymed!=TYMED_ISTREAM)return DV_E_TYMED;
      STGMEDIUM snapshot{};
      const HRESULT captured=clipboardSnapshotStream(format->cfFormat,*value,true,&snapshot);
      if(FAILED(captured)){blocked(true);return E_ACCESSDENIED;}
      const HRESULT answer=source->SetData(format,&snapshot,release);
      if(FAILED(answer) || !release)ReleaseStgMedium(&snapshot);
      else ReleaseStgMedium(value); // Ownership transfers only on success.
      return answer;
    }
    if (!direction(true) || (current().active && (value->tymed!=TYMED_HGLOBAL || !contentAllowed(format->cfFormat,value->hGlobal,current())))) {
      blocked(true); return E_ACCESSDENIED;
    }
    return source->SetData(format,value,release);
  }
  /** 中文：检查方向后包装源枚举器，使返回格式及 medium 继续由 GuardedFormats 过滤。 English: Check direction and wrap the source enumerator so GuardedFormats continues filtering formats/media. 参数声明 / Declared parameters: DWORD mode,IEnumFORMATETC** out. */
  HRESULT STDMETHODCALLTYPE EnumFormatEtc(DWORD mode,IEnumFORMATETC** out) override {
    if(!out)return E_POINTER;
    *out=nullptr;
    if(!direction(copy)){blocked(copy);return E_ACCESSDENIED;}
    IEnumFORMATETC* data=nullptr;const HRESULT answer=source->EnumFormatEtc(mode,&data);
    if(FAILED(answer)||!data)return answer;
    try{*out=new GuardedFormats(data,copy);}catch(...){data->Release();return E_OUTOFMEMORY;}
    data->Release();return answer;
  }
  /** 中文：活动策略下拒绝未受保护的推送通知通道；非活动状态委托源对象建立订阅。 English: Refuse unguarded push notifications under active policy and delegate subscription when inactive. 参数声明 / Declared parameters: FORMATETC* f,DWORD a,IAdviseSink* s,DWORD* c. */
  HRESULT STDMETHODCALLTYPE DAdvise(FORMATETC* f,DWORD a,IAdviseSink* s,DWORD* c) override {
    return current().active ? OLE_E_ADVISENOTSUPPORTED : source->DAdvise(f,a,s,c);
  }
  /** 中文：委托源对象取消既有订阅，允许策略收紧后仍清理先前资源。 English: Delegate cancellation so preexisting subscriptions can still be cleaned up after policy tightens. 参数声明 / Declared parameters: DWORD c. */
  HRESULT STDMETHODCALLTYPE DUnadvise(DWORD c) override { return source->DUnadvise(c); }
  /** 中文：活动策略下不暴露通知枚举通道；非活动时委托源通知枚举。 English: Hide the advisory enumeration channel under active policy and delegate it when inactive. 参数声明 / Declared parameters: IEnumSTATDATA** out. */
  HRESULT STDMETHODCALLTYPE EnumDAdvise(IEnumSTATDATA** out) override {
    return current().active ? OLE_E_ADVISENOTSUPPORTED : source->EnumDAdvise(out);
  }
};
/** 中文：检查粘贴方向，在授权元数据作用域取得原对象并返回受保护代理；所有临时 COM 引用在失败和成功后平衡。 English: Check paste direction, retrieve under authorized metadata scope and return a guarded proxy, balancing temporary COM references on success/failure. 参数声明 / Declared parameters: IDataObject** out. */
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
/** 中文：清空旧剪贴板前完整枚举至多 65536 项并检查每种暴露的文本 medium，允许混合格式过滤但需至少有效业务格式；前后规则变化拒绝。 English: Before clearing old clipboard, fully enumerate up to 65536 entries and inspect each exposed text medium; permit mixed-format filtering but require a usable application format and unchanged policy. 参数声明 / Declared parameters: IDataObject* data. */
static bool preflightOleCopy(IDataObject* data) {
  const auto initial=current();
  if(!initial.active)return true;
  IEnumFORMATETC* formats=nullptr;
  const HRESULT enumerated=data->EnumFormatEtc(DATADIR_GET,&formats);
  if(FAILED(enumerated) || !formats)return false;
  bool eligible=false,complete=false,allowed=true;
  for(unsigned index=0;index<65536 && allowed;++index){
    FORMATETC format{};ULONG fetched=0;
    const HRESULT next=formats->Next(1,&format,&fetched);
    if(FAILED(next) || fetched>1){if(format.ptd)CoTaskMemFree(format.ptd);allowed=false;break;}
    if(!fetched){if(format.ptd)CoTaskMemFree(format.ptd);complete=next==S_FALSE;break;}
    const auto rule=current();
    if(!direction(true)){if(format.ptd)CoTaskMemFree(format.ptd);allowed=false;break;}
    const bool plain=plainFormat(format.cfFormat);
    // Keep mixed-format filtering: unapproved alternate formats are hidden by
    // GuardedData, rather than rejecting an otherwise valid plain-text copy.
    if(formatAllowed(format.cfFormat,rule) && (!plain || (format.tymed&(TYMED_HGLOBAL|TYMED_ISTREAM)))){
      if(format.cfFormat!=CF_LOCALE)eligible=true;
      if(plain){
        const DWORD offered=format.tymed;
        // Check every text medium we advertise, including objects that expose
        // different bytes in HGLOBAL and IStream for the same format.
        for(const DWORD kind:{DWORD(TYMED_HGLOBAL),DWORD(TYMED_ISTREAM)}){
          if(!allowed || !(offered&kind))continue;
          format.tymed=kind;STGMEDIUM medium{};
          const HRESULT supplied=data->GetData(&format,&medium);
          if(FAILED(supplied))allowed=false;
          else {
            if(medium.tymed!=kind)allowed=false;
            else if(kind==TYMED_ISTREAM){
              ClipboardTextStream snapshot;
              const HRESULT captured=snapshot.capture(medium.pstm,current().maximum);
              const auto latest=current();
              allowed=SUCCEEDED(captured) && directionAllowed(true,latest) && snapshot.allowed(format.cfFormat,latest);
            }else allowed=clipboardMediumAllowed(format.cfFormat,medium,true);
            ReleaseStgMedium(&medium);
          }
        }
      }
    }
    if(format.ptd)CoTaskMemFree(format.ptd);
    if(next!=S_OK){allowed=false;break;}
  }
  formats->Release();
  const auto latest=current();
  return allowed && complete && eligible && direction(true) && initial.active==latest.active &&
    initial.flags==latest.flags && initial.maximum==latest.maximum;
}
/** 中文：先检查延迟对象完整文本再调用原 OleSetClipboard，防止拒绝时已破坏旧内容；写入对象持续用 GuardedData 检查。 English: Inspect delayed-object text before original OleSetClipboard to avoid destroying old contents on refusal, then retain GuardedData checks for later rendering. 参数声明 / Declared parameters: IDataObject* data. */
static HRESULT WINAPI oleSet(IDataObject* data) {
  if (!direction(true)) { blocked(true); return E_ACCESSDENIED; }
  OleTransportScope transport;
  if (!data) return originalOleSet(nullptr);
  // OleSetClipboard empties the previous clipboard before asking a delayed
  // object for its data. Read complete exposed plain text first. If it cannot
  // be inspected, reject here instead of destroying unrelated old contents.
  bool allowed=false;
  try{allowed=preflightOleCopy(data);}catch(...){allowed=false;}
  if(!allowed || !direction(true)){blocked(true);return E_ACCESSDENIED;}
  GuardedData* wrapped=nullptr;
  try { wrapped=new GuardedData(data,true); } catch (...) { return E_OUTOFMEMORY; }
  const HRESULT result=originalOleSet(wrapped);
  wrapped->Release(); return result;
}
/** 中文：仅在复制允许时授权 OLE 元数据并委托持久化，拒绝计数和返回 ACCESSDENIED。 English: Authorize OLE metadata and delegate persistence only when copying is allowed; count refusals and return ACCESSDENIED. */
static HRESULT WINAPI oleFlush() {
  if (!direction(true)) { blocked(true); return E_ACCESSDENIED; }
  OleTransportScope transport;
  return originalOleFlush();
}
/** 中文：用 MinHook 按系统模块导出名注册替换，保存原函数入口，仅 MH_OK 表示成功。 English: Register a replacement by system module/export through MinHook and retain the original entry; only MH_OK succeeds. 参数声明 / Declared parameters: const wchar_t* module,const char* name,void* replacement,T* original. */
template<class T> static bool hook(const wchar_t* module,const char* name,void* replacement,T* original) {
  return MH_CreateHookApi(module,name,replacement,reinterpret_cast<void**>(original))==MH_OK;
}
/** 中文：在当前 Detours 事务内绑定静态系统函数并保存 trampoline，失败由调用方中止整个事务。 English: Bind a static system function and retain its trampoline in the current Detours transaction; callers abort the whole transaction on failure. 参数声明 / Declared parameters: T* original,T source,void* replacement. */
template<class T> static bool earlyHook(T* original,T source,void* replacement) {
  *original=source;
  return DetourAttach(reinterpret_cast<void**>(original),replacement)==NO_ERROR;
}
/** 中文：核对已加载模块的完整 System32 路径，拒绝同名私有 DLL，长度/API 失败也返回 false。 English: Verify the loaded module's exact system-directory path, rejecting same-named private DLLs and length/API failures. 参数声明 / Declared parameters: const wchar_t* name. */
static bool earlySystemModule(const wchar_t* name) {
  wchar_t actual[MAX_PATH]{},system[MAX_PATH]{};
  const HMODULE module=GetModuleHandleW(name);
  const UINT size=GetSystemDirectoryW(system,MAX_PATH);
  const DWORD length=module?GetModuleFileNameW(module,actual,MAX_PATH):0;
  return size && size<MAX_PATH && length && length<MAX_PATH &&
    CompareStringOrdinal(actual,int(size),system,int(size),TRUE)==CSTR_EQUAL && actual[size]==L'\\' &&
    CompareStringOrdinal(actual+size+1,-1,name,-1,TRUE)==CSTR_EQUAL;
}
/** 中文：从实际 SetWindowSubclass 地址找到模块并核对受保护系统/WinSxS 来源，而非仅凭文件名。 English: Resolve the module from the actual SetWindowSubclass address and verify protected system/WinSxS provenance rather than a filename alone. */
static bool systemControlsLoaded() {
  wchar_t actual[MAX_PATH]{};
  HMODULE module=nullptr;
  if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCWSTR>(&SetWindowSubclass),&module))return false;
  const DWORD length=module?GetModuleFileNameW(module,actual,MAX_PATH):0;
  return length && length<MAX_PATH && controlSystemImage(actual);
}
/** 中文：loader lock 下只使用已静态加载依赖，核对载荷和共享策略后仅登记启动线程；整组 Detours 原子提交，任何步骤失败不得运行原初始化代码。 English: Under loader lock use only statically loaded dependencies, verify payload/shared policy and enlist only the startup thread; commit all Detours atomically and refuse original initialization on any failure. 参数声明 / Declared parameters: const SakuraClipboardEarly* input. */
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
      !earlySystemModule(L"user32.dll") || !earlySystemModule(L"ole32.dll") || !earlySystemModule(L"advapi32.dll") || !earlySystemModule(L"shell32.dll") || !systemControlsLoaded())return false;
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
      !earlyHook(&originalOleFlush,&OleFlushClipboard,reinterpret_cast<void*>(&oleFlush)) ||
      !earlyHook(&originalProcessW,&CreateProcessW,reinterpret_cast<void*>(&descendantCreateW)) ||
      !earlyHook(&originalProcessA,&CreateProcessA,reinterpret_cast<void*>(&descendantCreateA)) ||
      !earlyHook(&originalProcessAsUserW,&CreateProcessAsUserW,reinterpret_cast<void*>(&descendantCreateAsUserW)) ||
      !earlyHook(&originalProcessAsUserA,&CreateProcessAsUserA,reinterpret_cast<void*>(&descendantCreateAsUserA)) ||
      !earlyHook(&originalProcessWithTokenW,&CreateProcessWithTokenW,reinterpret_cast<void*>(&descendantCreateWithTokenW)) ||
      !earlyHook(&originalProcessWithLogonW,&CreateProcessWithLogonW,reinterpret_cast<void*>(&descendantCreateWithLogonW)) ||
      !earlyHook(&originalShellExW,&ShellExecuteExW,reinterpret_cast<void*>(&shellExecuteExW)) ||
      !earlyHook(&originalShellExA,&ShellExecuteExA,reinterpret_cast<void*>(&shellExecuteExA)) ||
      !earlyHook(&originalShellW,&ShellExecuteW,reinterpret_cast<void*>(&shellExecuteW)) ||
      !earlyHook(&originalShellA,&ShellExecuteA,reinterpret_cast<void*>(&shellExecuteA)) ||
      !earlyHook(&originalShellInitialize,&InitializeProcThreadAttributeList,reinterpret_cast<void*>(&shellInitialize)) ||
      !earlyHook(&originalShellUpdate,&UpdateProcThreadAttribute,reinterpret_cast<void*>(&shellUpdate)) ||
      !earlyHook(&originalShellDelete,&DeleteProcThreadAttributeList,reinterpret_cast<void*>(&shellDelete)) ||
      !earlyHook(&originalCreateW,&CreateWindowExW,reinterpret_cast<void*>(&createControlW)) ||
      !earlyHook(&originalCreateA,&CreateWindowExA,reinterpret_cast<void*>(&createControlA)) ||
      !earlyHook(&originalMessageW,&GetMessageW,reinterpret_cast<void*>(&messageControlW)) ||
      !earlyHook(&originalMessageA,&GetMessageA,reinterpret_cast<void*>(&messageControlA)) ||
      !earlyHook(&originalPeekW,&PeekMessageW,reinterpret_cast<void*>(&peekControlW)) ||
      !earlyHook(&originalPeekA,&PeekMessageA,reinterpret_cast<void*>(&peekControlA))) {
    DetourTransactionAbort();return false;
  }
  if(DetourTransactionCommit()!=NO_ERROR)return false;
  InterlockedExchange(&shared->status,1);
  return true;
}
// Detours' first import refers to ordinal 1. The loader resolves this symbol;
// it does not execute it. The existing named configuration entry stays intact.
/** 中文：提供 Detours 第一导入所需的序号符号；加载器只解析地址，此空导出不执行配置。 English: Provide the ordinal symbol required by Detours' first import; the loader resolves its address and the empty export does not configure policy. */
extern "C" __declspec(dllexport) void WINAPI SakuraClipboardEarlyOrdinal() {}
/** 中文：互斥配置普通运行进程，核对共享身份并安装所有钩子、确认既有控件；失败卸载钩子/映射并返回阶段错误码，同一段重复配置幂等。 English: Serialize ordinary-process configuration, verify shared identity, install all hooks and confirm existing controls; on failure unwind hooks/mapping and return stage codes, with same-section reconfiguration idempotent. 参数声明 / Declared parameters: void* pointer. */
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
            !LoadLibraryExW(L"ole32.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32) || !LoadLibraryExW(L"shell32.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32) || !earlySystemModule(L"shell32.dll") || !systemControlsLoaded() || MH_Initialize()!=MH_OK ||
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
            !hook(L"kernel32","CreateProcessW",reinterpret_cast<void*>(&descendantCreateW),&originalProcessW) ||
            !hook(L"kernel32","CreateProcessA",reinterpret_cast<void*>(&descendantCreateA),&originalProcessA) ||
            !hook(L"advapi32","CreateProcessAsUserW",reinterpret_cast<void*>(&descendantCreateAsUserW),&originalProcessAsUserW) ||
            !hook(L"advapi32","CreateProcessAsUserA",reinterpret_cast<void*>(&descendantCreateAsUserA),&originalProcessAsUserA) ||
            !hook(L"advapi32","CreateProcessWithTokenW",reinterpret_cast<void*>(&descendantCreateWithTokenW),&originalProcessWithTokenW) ||
            !hook(L"advapi32","CreateProcessWithLogonW",reinterpret_cast<void*>(&descendantCreateWithLogonW),&originalProcessWithLogonW) ||
            !hook(L"shell32","ShellExecuteExW",reinterpret_cast<void*>(&shellExecuteExW),&originalShellExW) ||
            !hook(L"shell32","ShellExecuteExA",reinterpret_cast<void*>(&shellExecuteExA),&originalShellExA) ||
            !hook(L"shell32","ShellExecuteW",reinterpret_cast<void*>(&shellExecuteW),&originalShellW) ||
            !hook(L"shell32","ShellExecuteA",reinterpret_cast<void*>(&shellExecuteA),&originalShellA) ||
            !hook(L"kernel32","InitializeProcThreadAttributeList",reinterpret_cast<void*>(&shellInitialize),&originalShellInitialize) ||
            !hook(L"kernel32","UpdateProcThreadAttribute",reinterpret_cast<void*>(&shellUpdate),&originalShellUpdate) ||
            !hook(L"kernel32","DeleteProcThreadAttributeList",reinterpret_cast<void*>(&shellDelete),&originalShellDelete) ||
            !hook(L"user32","CreateWindowExW",reinterpret_cast<void*>(&createControlW),&originalCreateW) ||
            !hook(L"user32","CreateWindowExA",reinterpret_cast<void*>(&createControlA),&originalCreateA) ||
            !hook(L"user32","GetMessageW",reinterpret_cast<void*>(&messageControlW),&originalMessageW) ||
            !hook(L"user32","GetMessageA",reinterpret_cast<void*>(&messageControlA),&originalMessageA) ||
            !hook(L"user32","PeekMessageW",reinterpret_cast<void*>(&peekControlW),&originalPeekW) ||
            !hook(L"user32","PeekMessageA",reinterpret_cast<void*>(&peekControlA),&originalPeekA) ||
            MH_EnableHook(MH_ALL_HOOKS)!=MH_OK || !attachExistingControls()) {
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
/** 中文：保存模块实例并关闭线程通知；静态受控导入必须携带匹配早期载荷且全部配置成功，否则拒绝进程初始化，普通显式加载保留后续配置入口。 English: Save the instance/disable thread notifications; controlled static imports require matching early payload and complete configuration or process initialization is refused, while ordinary explicit loads retain later configuration. 参数声明 / Declared parameters: HINSTANCE instance,DWORD reason,LPVOID reserved. */
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID reserved) {
  if (reason==DLL_PROCESS_ATTACH) {
    policyModule=instance;
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
