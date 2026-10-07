/**
 * 中文：Windows GnuPG Assuan 中继，通过已持有句柄固定私有源、helper 和创建者进程，并在 nonce 发送前核对实际 TCP 对端。严格元数据解析、完整行转发、BYE 回执和 EOF 状态机限制连接；失败实际关闭 socket 并只报告控制元数据。
 * English: Windows GnuPG Assuan relay pins private source, helper and creator process through held handles and checks the actual TCP peer before sending a nonce. Strict metadata parsing, complete-line forwarding and a BYE-receipt/EOF state machine bound the connection; failures physically close sockets and report only control metadata.
 */
#define _WIN32_WINNT 0x0A00
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winternl.h>
#include <aclapi.h>
#include <sddl.h>
#include <iphlpapi.h>
#include <bcrypt.h>
#include <array>
#include <vector>
#include <string>
#include <sstream>
#include <iostream>
#include <iomanip>
#include <stdexcept>
#include <algorithm>
#include <chrono>
#include <thread>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <io.h>
#include <map>
#include <tlhelp32.h>
#ifndef FILE_ATTRIBUTE_RECALL_ON_OPEN
#define FILE_ATTRIBUTE_RECALL_ON_OPEN 0x00040000
#endif
#ifndef FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
#define FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS 0x00400000
#endif

// Fixed production transport. This program never launches, stops, or configures an Agent.
struct Handle {
  HANDLE v=INVALID_HANDLE_VALUE;
  /**
   * 中文：建立无效、接管原始或移动后的唯一 Windows 句柄所有权；复制构造明确禁用。
   * English: Establishes invalid, adopted or moved unique Windows-handle ownership; copying is explicitly disabled.
   * 参数 / Parameters: `Handle()`.
   */
  Handle()=default;
  /**
   * 中文：建立无效、接管原始或移动后的唯一 Windows 句柄所有权；复制构造明确禁用。
   * English: Establishes invalid, adopted or moved unique Windows-handle ownership; copying is explicitly disabled.
   * 参数 / Parameters: `Handle(HANDLE value)`.
   */
  explicit Handle(HANDLE value):v(value){}
  /**
   * 中文：建立无效、接管原始或移动后的唯一 Windows 句柄所有权；复制构造明确禁用。
   * English: Establishes invalid, adopted or moved unique Windows-handle ownership; copying is explicitly disabled.
   * 参数 / Parameters: `Handle(const Handle&)`.
   */
  Handle(const Handle&)=delete;
  /**
   * 中文：禁止复制；移动赋值先释放旧句柄，再接管新句柄并清空来源。
   * English: Forbids copying; move assignment releases the prior handle, adopts the new one and clears its source.
   * 参数 / Parameters: `& operator=(const Handle&)`.
   */
  Handle& operator=(const Handle&)=delete;
  /**
   * 中文：建立无效、接管原始或移动后的唯一 Windows 句柄所有权；复制构造明确禁用。
   * English: Establishes invalid, adopted or moved unique Windows-handle ownership; copying is explicitly disabled.
   * 参数 / Parameters: `Handle(Handle&& o) noexcept`.
   */
  Handle(Handle&& o) noexcept:v(o.v){o.v=INVALID_HANDLE_VALUE;}
  /**
   * 中文：禁止复制；移动赋值先释放旧句柄，再接管新句柄并清空来源。
   * English: Forbids copying; move assignment releases the prior handle, adopts the new one and clears its source.
   * 参数 / Parameters: `& operator=(Handle&& o) noexcept`.
   */
  Handle& operator=(Handle&& o) noexcept {if(this!=&o){reset();v=o.v;o.v=INVALID_HANDLE_VALUE;}return *this;}
  /**
   * 中文：关闭当前有效句柄并重置为无效值，防止重复关闭。
   * English: Closes the current valid handle and resets it to an invalid value, preventing double closure.
   * 参数 / Parameters: `reset()`.
   */
  void reset(){if(v!=INVALID_HANDLE_VALUE&&v)CloseHandle(v);v=INVALID_HANDLE_VALUE;}
  /**
   * 中文：析构时释放唯一持有的 Windows 句柄。
   * English: Releases the uniquely owned Windows handle on destruction.
   * 参数 / Parameters: `~Handle()`.
   */
  ~Handle(){reset();}
};
struct Sock { SOCKET v=INVALID_SOCKET;
/**
 * 中文：析构时关闭仍有效的 Winsock socket。
 * English: Closes a still-valid Winsock socket on destruction.
 * 参数 / Parameters: `~Sock()`.
 */
~Sock(){if(v!=INVALID_SOCKET)closesocket(v);} };
using Clock=std::chrono::steady_clock;
/**
 * 中文：将不满足的安全前置条件转换为指定错误码异常。
 * English: Turns a failed security precondition into an exception carrying the supplied error code.
 * 参数 / Parameters: `need(bool condition,const char* code)`.
 */
static void need(bool condition,const char* code){if(!condition)throw std::runtime_error(code);}
/**
 * 中文：将 UTF-16 Windows 字符串严格转换为 UTF-8，编码或 API 失败拒绝。
 * English: Strictly converts a Windows UTF-16 string to UTF-8, refusing encoding/API failures.
 * 参数 / Parameters: `utf8(const std::wstring& value)`.
 * 拒绝码 / Refusal codes: UTF8.
 */
static std::string utf8(const std::wstring& value) {
  int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),(int)value.size(),nullptr,0,nullptr,nullptr);
  need(n>0||value.empty(),"UTF8");std::string out(n,'\0');
  if(n)WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),(int)value.size(),out.data(),n,nullptr,nullptr);
  return out;
}
/**
 * 中文：将字节串编码为 JSON 字符串，转义引号、反斜线和控制字符。
 * English: Encodes bytes as a JSON string, escaping quotes, backslashes and control characters.
 * 参数 / Parameters: `jq(const std::string& value)`.
 */
static std::string jq(const std::string& value) {
  std::ostringstream out;out<<'"';for(unsigned char c:value){if(c=='"'||c=='\\')out<<'\\'<<c;else if(c<32)out<<"\\u"<<std::hex<<std::setw(4)<<std::setfill('0')<<(int)c;else out<<c;}out<<'"';return out.str();
}
/**
 * 中文：向 stderr 输出一行 JSON 控制事件并刷新，输出流失败则拒绝。
 * English: Writes one JSON control-event line to stderr and flushes, refusing an output-stream failure.
 * 参数 / Parameters: `event(const std::string& body)`.
 * 拒绝码 / Refusal codes: REPORT_WRITE.
 */
static void event(const std::string& body){std::cerr<<body<<"\n";std::cerr.flush();need((bool)std::cerr,"REPORT_WRITE");}
/**
 * 中文：用 Windows BCrypt 计算缓冲区 SHA-256 并释放哈希及算法句柄。
 * English: Computes buffer SHA-256 with Windows BCrypt and releases hash/algorithm handles.
 * 参数 / Parameters: `hash(const void* bytes,size_t length)`.
 * 拒绝码 / Refusal codes: HASH_ALG, HASH.
 */
static std::string hash(const void* bytes,size_t length) {
  BCRYPT_ALG_HANDLE alg=nullptr;BCRYPT_HASH_HANDLE state=nullptr;DWORD n=0,size=0;
  need(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,nullptr,0)>=0,"HASH_ALG");
  if(BCryptGetProperty(alg,BCRYPT_OBJECT_LENGTH,(PUCHAR)&size,sizeof size,&n,0)<0){BCryptCloseAlgorithmProvider(alg,0);throw std::runtime_error("HASH_SIZE");}
  std::vector<unsigned char> object(size);std::array<unsigned char,32> result{};
  NTSTATUS status=BCryptCreateHash(alg,&state,object.data(),size,nullptr,0,0);
  if(status>=0)status=BCryptHashData(state,(PUCHAR)bytes,(ULONG)length,0);
  if(status>=0)status=BCryptFinishHash(state,result.data(),result.size(),0);
  if(state)BCryptDestroyHash(state);BCryptCloseAlgorithmProvider(alg,0);need(status>=0,"HASH");
  std::ostringstream out;for(auto c:result)out<<std::hex<<std::setw(2)<<std::setfill('0')<<(int)c;return out.str();
}
/**
 * 中文：把 SID 转为稳定文本身份并释放 Windows 分配的字符串。
 * English: Converts a SID to a stable text identity and releases the Windows-allocated string.
 * 参数 / Parameters: `sid(PSID value)`.
 * 拒绝码 / Refusal codes: SID.
 */
static std::string sid(PSID value) {
  LPSTR text=nullptr;need(ConvertSidToStringSidA(value,&text),"SID");std::string result(text);LocalFree(text);return result;
}
/**
 * 中文：查询当前进程令牌中的用户 SID，作为文件和进程所有权校验基准。
 * English: Queries the current process token's user SID as the file/process ownership reference.
 * 参数 / Parameters: `ownSid()`.
 * 拒绝码 / Refusal codes: TOKEN, TOKEN_USER.
 */
static std::string ownSid() {
  Handle token;need(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.v),"TOKEN");DWORD n=0;GetTokenInformation(token.v,TokenUser,nullptr,0,&n);
  std::vector<unsigned char> b(n);need(GetTokenInformation(token.v,TokenUser,b.data(),n,&n),"TOKEN_USER");return sid(((TOKEN_USER*)b.data())->User.Sid);
}
struct FileInfo {std::string id,owner,aclHash;DWORD attributes=0,links=0;bool directory=false,protectedAcl=false;};
/**
 * 中文：比较文件 ID、所有者、ACL 摘要、属性、链接和目录类型等固定身份字段。
 * English: Compares pinned file identity fields including ID, owner, ACL digest, attributes, links and directory type.
 * 参数 / Parameters: `jsonComparable(const FileInfo& a,const FileInfo& b)`.
 */
static bool jsonComparable(const FileInfo& a,const FileInfo& b){return a.id==b.id&&a.owner==b.owner&&a.aclHash==b.aclHash&&a.attributes==b.attributes&&a.links==b.links&&a.directory==b.directory&&a.protectedAcl==b.protectedAcl;}
/**
 * 中文：读取句柄文件身份和 ACL，拒绝重解析/离线属性，并按 private 要求检查同用户及受限授权。
 * English: Reads handle-based file identity/ACL, rejects reparse/offline attributes and enforces same-user restricted grants when private is required.
 * 参数 / Parameters: `info(HANDLE handle,bool privateObject)`.
 * 拒绝码 / Refusal codes: FILE_ID128, FILE_TAG, SOURCE_REPARSE, SOURCE_OFFLINE, FILE_STANDARD, SOURCE_ACL, SOURCE_OWNER_OR_ACL.
 */
static FileInfo info(HANDLE handle,bool privateObject) {
  FILE_ID_INFO id{};FILE_ATTRIBUTE_TAG_INFO tag{};FILE_STANDARD_INFO standard{};
  need(GetFileInformationByHandleEx(handle,FileIdInfo,&id,sizeof id),"FILE_ID128");
  need(GetFileInformationByHandleEx(handle,FileAttributeTagInfo,&tag,sizeof tag),"FILE_TAG");
  need(!(tag.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT),"SOURCE_REPARSE");
  need(!(tag.FileAttributes&(FILE_ATTRIBUTE_OFFLINE|FILE_ATTRIBUTE_RECALL_ON_OPEN|FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)),"SOURCE_OFFLINE");
  need(GetFileInformationByHandleEx(handle,FileStandardInfo,&standard,sizeof standard),"FILE_STANDARD");
  PSID owner=nullptr;PACL acl=nullptr;PSECURITY_DESCRIPTOR descriptor=nullptr;
  DWORD error=GetSecurityInfo(handle,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&owner,nullptr,&acl,nullptr,&descriptor);
  need(error==ERROR_SUCCESS&&owner&&acl&&descriptor,"SOURCE_ACL");
  FileInfo out;out.owner=sid(owner);out.aclHash=hash(acl,acl->AclSize);out.attributes=tag.FileAttributes;out.links=standard.NumberOfLinks;out.directory=standard.Directory;
  SECURITY_DESCRIPTOR_CONTROL control{};DWORD revision=0;GetSecurityDescriptorControl(descriptor,&control,&revision);out.protectedAcl=(control&SE_DACL_PROTECTED)!=0;
  std::ostringstream ident;ident<<std::hex<<id.VolumeSerialNumber<<":";for(auto c:id.FileId.Identifier)ident<<std::setw(2)<<std::setfill('0')<<(int)c;out.id=ident.str();
  bool allowed=true;const std::string self=ownSid();
  if(privateObject) {
    allowed=out.owner==self;
    for(DWORD i=0;i<acl->AceCount&&allowed;i++) {
      void* raw=nullptr;if(!GetAce(acl,i,&raw)){allowed=false;break;}
      auto header=(ACE_HEADER*)raw;if(header->AceFlags&INHERIT_ONLY_ACE)continue;
      if(header->AceType==ACCESS_DENIED_ACE_TYPE)continue;
      if(header->AceType!=ACCESS_ALLOWED_ACE_TYPE){allowed=false;break;}
      auto ace=(ACCESS_ALLOWED_ACE*)raw;std::string principal=sid((PSID)&ace->SidStart);
      if(ace->Mask&&principal!=self&&principal!="S-1-5-18"&&principal!="S-1-5-32-544")allowed=false;
    }
  }
  LocalFree(descriptor);need(allowed,"SOURCE_OWNER_OR_ACL");return out;
}
/**
 * 中文：将已校验文件身份序列化为控制消息元数据。
 * English: Serializes validated file identity into control-message metadata.
 * 参数 / Parameters: `json(const FileInfo& f)`.
 */
static std::string json(const FileInfo& f){return "{\"id\":"+jq(f.id)+",\"owner\":"+jq(f.owner)+",\"aclSha256\":"+jq(f.aclHash)+",\"attributes\":"+std::to_string(f.attributes)+",\"links\":"+std::to_string(f.links)+",\"directory\":"+(f.directory?"true":"false")+",\"protectedAcl\":"+(f.protectedAcl?"true":"false")+"}";}
using NtCreateFn=NTSTATUS(NTAPI*)(PHANDLE,ACCESS_MASK,POBJECT_ATTRIBUTES,PIO_STATUS_BLOCK,PLARGE_INTEGER,ULONG,ULONG,ULONG,ULONG,PVOID,ULONG);
/**
 * 中文：通过父目录句柄相对打开单个安全路径组件，固定文件身份并拒绝写入/删除共享。
 * English: Opens one safe path component relative to a parent handle, pinning identity and denying write/delete sharing.
 * 参数 / Parameters: `openChild(HANDLE parent,const std::wstring& name,bool readData=false)`.
 * 拒绝码 / Refusal codes: PATH_COMPONENT, NT_OPEN_API.
 * 设计 / Design: 目录仅需属性和 ACL 访问；不请求目录读数据，以免阻止 GnuPG 原子重命名，但共享限制仍保持。
 * Directories need only attributes/ACL access, avoiding directory-read access that blocks GnuPG atomic renames while retaining sharing restrictions.
 */
static Handle openChild(HANDLE parent,const std::wstring& name,bool readData=false) {
  need(!name.empty()&&name!=L"."&&name!=L".."&&name.back()!=L'.'&&name.back()!=L' ',"PATH_COMPONENT");
  need(name.find_first_of(L":\\/*?\"<>|")==std::wstring::npos&&name.size()<256,"PATH_COMPONENT");
  UNICODE_STRING text{};text.Buffer=(PWSTR)name.data();text.Length=(USHORT)(name.size()*2);text.MaximumLength=text.Length;
  OBJECT_ATTRIBUTES attributes{};attributes.Length=sizeof attributes;attributes.RootDirectory=parent;attributes.ObjectName=&text;attributes.Attributes=OBJ_CASE_INSENSITIVE;
  IO_STATUS_BLOCK io{};Handle result;
  auto nt=(NtCreateFn)GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtCreateFile");need(nt,"NT_OPEN_API");
  // FILE_READ_DATA means FILE_LIST_DIRECTORY for a directory. Holding that
  // access with read-only sharing blocks GnuPG's atomic keyring renames.
  // Directory pins need attributes/ACL only; keep write/delete sharing denied.
  const ACCESS_MASK access=FILE_READ_ATTRIBUTES|READ_CONTROL|SYNCHRONIZE|(readData?FILE_READ_DATA:0);
  NTSTATUS status=nt(&result.v,access,&attributes,&io,nullptr,0,FILE_SHARE_READ,FILE_OPEN,FILE_OPEN_REPARSE_POINT|FILE_SYNCHRONOUS_IO_NONALERT,nullptr,0);
  if(status<0){result.v=INVALID_HANDLE_VALUE;throw std::runtime_error("SOURCE_OPEN_"+std::to_string((uint32_t)status));}
  return result;
}
/**
 * 中文：按反斜线拆分相对路径，拒绝空组件，返回逐级句柄打开所需的组件列表。
 * English: Splits a relative path on backslashes, rejecting empty components and returning components for handle-by-handle opening.
 * 参数 / Parameters: `split(const std::wstring& text)`.
 * 拒绝码 / Refusal codes: PATH_EMPTY_COMPONENT.
 */
static std::vector<std::wstring> split(const std::wstring& text) {
  std::vector<std::wstring> parts;size_t from=0;
  while(from<text.size()){size_t to=text.find(L'\\',from);if(to==std::wstring::npos)to=text.size();need(to>from,"PATH_EMPTY_COMPONENT");parts.push_back(text.substr(from,to-from));from=to+1;}return parts;
}
struct Anchor {
  std::vector<Handle> handles;std::vector<FileInfo> originals;std::wstring path;
  /**
   * 中文：固定本地绝对路径的每级祖先句柄，要求最终私有锚点保护 DACL 并匹配可选预期 ID。
   * English: Pins every ancestor handle of a local absolute path, requiring a protected private-anchor DACL and optional expected ID.
   * 参数 / Parameters: `Anchor(const std::wstring& root,const std::string& expected="")`.
   * 拒绝码 / Refusal codes: LOCAL_DRIVE_PATH, DRIVE_OPEN, ANCESTOR_TYPE, ANCHOR_DACL_NOT_PROTECTED, ANCHOR_REPLACED.
   */
  explicit Anchor(const std::wstring& root,const std::string& expected=""):path(root) {
    need(root.size()>3&&iswalpha(root[0])&&root[1]==L':'&&root[2]==L'\\',"LOCAL_DRIVE_PATH");
    Handle drive(CreateFileW((L"\\\\?\\"+root.substr(0,3)).c_str(),FILE_READ_ATTRIBUTES|READ_CONTROL,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr));need(drive.v!=INVALID_HANDLE_VALUE,"DRIVE_OPEN");
    handles.push_back(std::move(drive));originals.push_back(info(handles.back().v,false));
    auto parts=split(root.substr(3));for(size_t i=0;i<parts.size();i++){handles.push_back(openChild(handles.back().v,parts[i]));originals.push_back(info(handles.back().v,i==parts.size()-1));need(originals.back().directory,"ANCESTOR_TYPE");}
    need(originals.back().protectedAcl,"ANCHOR_DACL_NOT_PROTECTED");if(!expected.empty())need(originals.back().id==expected,"ANCHOR_REPLACED");
  }
  /**
   * 中文：重新读取已持有祖先身份并逐项比较，任何替换或 ACL 变化都拒绝。
   * English: Re-reads held ancestor identities and compares each pin, refusing replacements or ACL changes.
   * 参数 / Parameters: `check()`.
   * 拒绝码 / Refusal codes: ANCESTOR_CHANGED.
   */
  void check(){for(size_t i=0;i<handles.size();i++){auto now=info(handles[i].v,i+1==handles.size());need(jsonComparable(now,originals[i]),"ANCESTOR_CHANGED");}}
  /**
   * 中文：输出原始祖先身份数组，供控制器构造源固定快照。
   * English: Emits original ancestor identities for the controller's source-pin snapshot.
   * 参数 / Parameters: `jsonAll()`.
   */
  std::string jsonAll(){std::string out="[";for(size_t i=0;i<originals.size();i++){if(i)out+=",";out+=json(originals[i]);}return out+"]";}
};
struct Source {
  Anchor anchor;std::vector<Handle> descendants;std::vector<FileInfo> originals;std::vector<unsigned char> bytes;std::string digest;uint16_t port=0;std::array<unsigned char,16> secret{};std::string kind;
  /**
   * 中文：在固定锚点下打开有限层级的 w32 源文件，校验类型/硬链接及可选 ID/摘要后解析并复核。
   * English: Opens a bounded-depth w32 source beneath the pinned anchor, checks type/link count and optional ID/hash, then parses and rechecks it.
   * 参数 / Parameters: `Source(const std::wstring& root,const std::wstring& relative,const std::string& mode,const std::string& rootId="",const std::string& leafId="",const std::string& expectedHash="")`.
   * 拒绝码 / Refusal codes: SOURCE_FORMAT_UNSUPPORTED, SOURCE_COMPONENTS, SOURCE_TYPE, SOURCE_LINK_COUNT, SOURCE_REPLACED, SOURCE_CONTENT_CHANGED.
   */
  Source(const std::wstring& root,const std::wstring& relative,const std::string& mode,const std::string& rootId="",const std::string& leafId="",const std::string& expectedHash=""):anchor(root,rootId),kind(mode) {
    need(mode=="w32","SOURCE_FORMAT_UNSUPPORTED");
    HANDLE current=anchor.handles.back().v;auto parts=split(relative);need(!parts.empty()&&parts.size()<=8,"SOURCE_COMPONENTS");
    for(size_t i=0;i<parts.size();i++){descendants.push_back(openChild(current,parts[i],i+1==parts.size()));current=descendants.back().v;originals.push_back(info(current,true));need(i+1==parts.size()?!originals.back().directory:originals.back().directory,"SOURCE_TYPE");}
    need(originals.back().links==1,"SOURCE_LINK_COUNT");if(!leafId.empty())need(originals.back().id==leafId,"SOURCE_REPLACED");
    read();digest=hash(bytes.data(),bytes.size());if(!expectedHash.empty())need(digest==expectedHash,"SOURCE_CONTENT_CHANGED");parse();check();
  }
  /**
   * 中文：从持有源句柄重新读取最多 128 字节，拒绝空文件、超长数据和读取失败。
   * English: Re-reads at most 128 bytes from the held source handle, refusing empty/oversized data and read failures.
   * 参数 / Parameters: `read()`.
   * 拒绝码 / Refusal codes: SOURCE_SEEK, SOURCE_SIZE.
   */
  void read(){LARGE_INTEGER zero{};need(SetFilePointerEx(descendants.back().v,zero,nullptr,FILE_BEGIN),"SOURCE_SEEK");std::array<unsigned char,129> b{};DWORD n=0;need(ReadFile(descendants.back().v,b.data(),b.size(),&n,nullptr)&&n>0&&n<=128,"SOURCE_SIZE");bytes.assign(b.begin(),b.begin()+n);}
  /**
   * 中文：解析十进制非零端口、换行及恰好 16 字节 nonce 的 w32 文件布局。
   * English: Parses the w32 layout of a nonzero decimal port, newline and exactly sixteen nonce bytes.
   * 参数 / Parameters: `parse()`.
   * 拒绝码 / Refusal codes: SOURCE_PORT, SOURCE_W32_FORMAT.
   */
  void parse() {
    size_t at=0;unsigned value=0;while(at<bytes.size()&&bytes[at]>='0'&&bytes[at]<='9'){value=value*10+(bytes[at++]-'0');need(value<=65535,"SOURCE_PORT");}
    need(at>0&&value&&at+17==bytes.size()&&bytes[at]=='\n',"SOURCE_W32_FORMAT");port=value;memcpy(secret.data(),bytes.data()+at+1,16);
  }
  /**
   * 中文：复核锚点和所有后代身份并重读源摘要，阻止源路径或内容在操作间变化。
   * English: Rechecks anchor/descendant identities and re-reads the source hash to prevent path/content changes between operations.
   * 参数 / Parameters: `check()`.
   * 拒绝码 / Refusal codes: SOURCE_CHANGED, SOURCE_CONTENT_CHANGED.
   */
  void check(){anchor.check();for(size_t i=0;i<descendants.size();i++){auto f=info(descendants[i].v,true);need(jsonComparable(f,originals[i]),"SOURCE_CHANGED");}auto old=digest;read();if(!old.empty())need(hash(bytes.data(),bytes.size())==old,"SOURCE_CONTENT_CHANGED");}
};
/**
 * 中文：将 FILETIME 高低字段合成为进程出生标识使用的 64 位值。
 * English: Combines FILETIME fields into the 64-bit value used to identify process birth.
 * 参数 / Parameters: `ticks(FILETIME v)`.
 */
static uint64_t ticks(FILETIME v){return ((uint64_t)v.dwHighDateTime<<32)|v.dwLowDateTime;}
struct Process {
  Handle handle;DWORD pid;uint64_t created;std::string sidValue,image;
  /**
   * 中文：固定活进程句柄、出生时间、同用户 SID 和映像路径，拒绝 PID 重用或已结束进程。
   * English: Pins a live process handle, birth time, same-user SID and image path, refusing PID reuse or ended processes.
   * 参数 / Parameters: `Process(DWORD p,uint64_t expected=0)`.
   * 拒绝码 / Refusal codes: PROCESS_OPEN, PROCESS_TIME, PROCESS_REPLACED, PROCESS_ENDED, PROCESS_TOKEN, PROCESS_SID, PROCESS_OWNER, PROCESS_IMAGE.
   */
  explicit Process(DWORD p,uint64_t expected=0):pid(p){handle=Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,p));need(handle.v!=INVALID_HANDLE_VALUE&&handle.v,"PROCESS_OPEN");FILETIME c{},e{},k{},u{};need(GetProcessTimes(handle.v,&c,&e,&k,&u),"PROCESS_TIME");created=ticks(c);if(expected)need(created==expected,"PROCESS_REPLACED");DWORD wait=WaitForSingleObject(handle.v,0);if(wait!=WAIT_TIMEOUT){DWORD exit=0;GetExitCodeProcess(handle.v,&exit);event("{\"event\":\"PROCESS_UNAVAILABLE\",\"pid\":"+std::to_string(pid)+",\"creationTime\":"+jq(std::to_string(created))+",\"wait\":"+std::to_string(wait)+",\"exitCode\":"+std::to_string(exit)+"}");}need(wait==WAIT_TIMEOUT,"PROCESS_ENDED");Handle token;need(OpenProcessToken(handle.v,TOKEN_QUERY,&token.v),"PROCESS_TOKEN");DWORD n=0;GetTokenInformation(token.v,TokenUser,nullptr,0,&n);std::vector<unsigned char> b(n);need(GetTokenInformation(token.v,TokenUser,b.data(),n,&n),"PROCESS_SID");sidValue=sid(((TOKEN_USER*)b.data())->User.Sid);need(sidValue==ownSid(),"PROCESS_OWNER");wchar_t file[32768];DWORD len=32768;BOOL got=QueryFullProcessImageNameW(handle.v,0,file,&len);if(!got)event("{\"event\":\"PROCESS_IMAGE_ERROR\",\"pid\":"+std::to_string(pid)+",\"windowsError\":"+std::to_string(GetLastError())+"}");need(got,"PROCESS_IMAGE");image=utf8(std::wstring(file,len));check();}
  /**
   * 中文：通过持有句柄复核进程仍活且出生、SID 和映像不变。
   * English: Rechecks through the held handle that the process remains live with unchanged birth, SID and image.
   * 参数 / Parameters: `check()`.
   * 拒绝码 / Refusal codes: PROCESS_ENDED, PROCESS_CHANGED, PROCESS_TOKEN, PROCESS_SID_CHANGED, PROCESS_IMAGE_CHANGED.
   */
  void check(){need(WaitForSingleObject(handle.v,0)==WAIT_TIMEOUT,"PROCESS_ENDED");FILETIME c{},e{},k{},u{};need(GetProcessTimes(handle.v,&c,&e,&k,&u)&&ticks(c)==created,"PROCESS_CHANGED");Handle token;need(OpenProcessToken(handle.v,TOKEN_QUERY,&token.v),"PROCESS_TOKEN");DWORD size=0;GetTokenInformation(token.v,TokenUser,nullptr,0,&size);std::vector<unsigned char> buffer(size);need(GetTokenInformation(token.v,TokenUser,buffer.data(),size,&size)&&sid(((TOKEN_USER*)buffer.data())->User.Sid)==sidValue,"PROCESS_SID_CHANGED");wchar_t filename[32768];DWORD length=32768;need(QueryFullProcessImageNameW(handle.v,0,filename,&length)&&utf8(std::wstring(filename,length))==image,"PROCESS_IMAGE_CHANGED");}
  /**
   * 中文：输出固定的进程 PID、出生时间、SID 和映像元数据。
   * English: Emits pinned process PID, birth time, SID and image metadata.
   * 参数 / Parameters: `jsonSelf()`.
   */
  std::string jsonSelf(){return "{\"pid\":"+std::to_string(pid)+",\"creationTime\":"+jq(std::to_string(created))+",\"sid\":"+jq(sidValue)+",\"image\":"+jq(image)+"}";}
};
/**
 * 中文：有界重试读取带 PID 的 IPv4 TCP 表，表变化或系统查询失败拒绝。
 * English: Reads the PID-bearing IPv4 TCP table with bounded retries, refusing persistent table changes or query failures.
 * 参数 / Parameters: `tcpRows()`.
 * 拒绝码 / Refusal codes: TCP_SIZE, TCP_QUERY.
 */
static std::vector<MIB_TCPROW_OWNER_PID> tcpRows() {
  DWORD n=0;DWORD code=GetExtendedTcpTable(nullptr,&n,FALSE,AF_INET,TCP_TABLE_OWNER_PID_ALL,0);need(code==ERROR_INSUFFICIENT_BUFFER,"TCP_SIZE");std::vector<unsigned char> b(n);
  for(int i=0;i<3;i++){code=GetExtendedTcpTable(b.data(),&n,FALSE,AF_INET,TCP_TABLE_OWNER_PID_ALL,0);if(code==ERROR_SUCCESS){auto table=(MIB_TCPTABLE_OWNER_PID*)b.data();return {table->table,table->table+table->dwNumEntries};}need(code==ERROR_INSUFFICIENT_BUFFER,"TCP_QUERY");b.resize(n);}throw std::runtime_error("TCP_CHANGED");
}
/**
 * 中文：查找指定端口的回环或通配监听者，要求至少一个且所有匹配项属于同一 PID。
 * English: Finds the loopback/wildcard listener for a port, requiring at least one match and a unique owning PID.
 * 参数 / Parameters: `listener(uint16_t port)`.
 * 拒绝码 / Refusal codes: TCP_AMBIGUOUS, TCP_LISTENER_ABSENT.
 */
static DWORD listener(uint16_t port){DWORD found=0;for(auto r:tcpRows()){if(r.dwState==MIB_TCP_STATE_LISTEN&&ntohs((uint16_t)r.dwLocalPort)==port&&(r.dwLocalAddr==htonl(INADDR_LOOPBACK)||r.dwLocalAddr==0)){need(!found||found==r.dwOwningPid,"TCP_AMBIGUOUS");found=r.dwOwningPid;}}need(found,"TCP_LISTENER_ABSENT");return found;}
/**
 * 中文：检查指定服务端口、客户端端口和 PID 的双向回环已建立连接是否存在。
 * English: Tests for an established loopback connection with the exact server port, client port and PID.
 * 参数 / Parameters: `tuple(uint16_t server,uint16_t client,DWORD pid)`.
 */
static bool tuple(uint16_t server,uint16_t client,DWORD pid){for(auto r:tcpRows()){if(r.dwState==MIB_TCP_STATE_ESTAB&&ntohs((uint16_t)r.dwLocalPort)==server&&ntohs((uint16_t)r.dwRemotePort)==client&&r.dwLocalAddr==htonl(INADDR_LOOPBACK)&&r.dwRemoteAddr==htonl(INADDR_LOOPBACK)&&r.dwOwningPid==pid)return true;}return false;}
/**
 * 中文：取得精确回环连接四元组的服务端 PID，多所有者歧义时拒绝。
 * English: Obtains the server PID for the exact loopback tuple, refusing ambiguous owners.
 * 参数 / Parameters: `accepted(uint16_t server,uint16_t client)`.
 * 拒绝码 / Refusal codes: TCP_AMBIGUOUS.
 */
static DWORD accepted(uint16_t server,uint16_t client){DWORD found=0;for(auto r:tcpRows()){if(r.dwState==MIB_TCP_STATE_ESTAB&&ntohs((uint16_t)r.dwLocalPort)==server&&ntohs((uint16_t)r.dwRemotePort)==client&&r.dwLocalAddr==htonl(INADDR_LOOPBACK)&&r.dwRemoteAddr==htonl(INADDR_LOOPBACK)){need(!found||found==r.dwOwningPid,"TCP_AMBIGUOUS");found=r.dwOwningPid;}}return found;}
static Process* controller=nullptr;
static bool controlEofRequired=true;
/**
 * 中文：复核控制父进程存活，要求控制管道未断开；错误和 EOF 都中止当前操作。
 * English: Rechecks the controlling parent and requires an unbroken control pipe, aborting on errors or EOF.
 * 参数 / Parameters: `checkControl()`.
 * 拒绝码 / Refusal codes: CONTROL_EOF.
 */
static void checkControl(){if(!controller)return;controller->check();if(!controlEofRequired)return;DWORD available=0;if(!PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE),nullptr,0,nullptr,&available,nullptr)){need(GetLastError()!=ERROR_BROKEN_PIPE,"CONTROL_EOF");throw std::runtime_error("CONTROL_PIPE");}}
/**
 * 中文：以短 select 周期等待可读/可写，同时检查控制端，直到给定截止时间。
 * English: Waits for socket read/write readiness in short select intervals, checking control state until the supplied deadline.
 * 参数 / Parameters: `waitSocket(SOCKET fd,bool write,Clock::time_point deadline)`.
 * 拒绝码 / Refusal codes: SOCKET_SELECT.
 */
static void waitSocket(SOCKET fd,bool write,Clock::time_point deadline) {
  while(Clock::now()<deadline){checkControl();fd_set f;FD_ZERO(&f);FD_SET(fd,&f);timeval t{0,50000};int n=select(0,write?nullptr:&f,write?&f:nullptr,nullptr,&t);need(n>=0,"SOCKET_SELECT");if(n)return;}throw std::runtime_error("SOCKET_TIMEOUT");
}
/**
 * 中文：在截止时间和控制存活约束下完整发送缓冲，零/失败发送拒绝。
 * English: Sends a complete buffer under deadline/control constraints, refusing zero or failed sends.
 * 参数 / Parameters: `sendAll(SOCKET fd,const void* data,size_t n,Clock::time_point deadline)`.
 * 拒绝码 / Refusal codes: SOCKET_SEND.
 */
static void sendAll(SOCKET fd,const void* data,size_t n,Clock::time_point deadline){auto bytes=(const char*)data;while(n){waitSocket(fd,true,deadline);int used=send(fd,bytes,(int)n,0);need(used>0,"SOCKET_SEND");bytes+=used;n-=used;}}
/**
 * 中文：在截止时间和控制存活约束下精确接收指定字节，EOF/失败拒绝。
 * English: Receives exactly the requested bytes under deadline/control constraints, refusing EOF or receive failure.
 * 参数 / Parameters: `recvAll(SOCKET fd,void* data,size_t n,Clock::time_point deadline)`.
 * 拒绝码 / Refusal codes: SOCKET_RECEIVE.
 */
static void recvAll(SOCKET fd,void* data,size_t n,Clock::time_point deadline){auto bytes=(char*)data;while(n){waitSocket(fd,false,deadline);int used=recv(fd,bytes,(int)n,0);need(used>0,"SOCKET_RECEIVE");bytes+=used;n-=used;}}
/**
 * 中文：读取有界 Assuan 握手行，要求换行且不含 NUL。
 * English: Reads a bounded Assuan handshake line, requiring newline termination and no NUL.
 * 参数 / Parameters: `readLine(SOCKET fd,Clock::time_point deadline)`.
 * 拒绝码 / Refusal codes: ASSUAN_NUL.
 */
static std::string readLine(SOCKET fd,Clock::time_point deadline){std::string out;while(out.size()<1000){char c;recvAll(fd,&c,1,deadline);need(c!='\0',"ASSUAN_NUL");out+=c;if(c=='\n')return out;}throw std::runtime_error("ASSUAN_LINE_SIZE");}
/**
 * 中文：完整写入标准输出二进制缓冲，短写或 API 错误拒绝。
 * English: Writes a complete binary buffer to stdout, refusing short writes or API errors.
 * 参数 / Parameters: `writeStdout(const void* p,size_t n)`.
 * 拒绝码 / Refusal codes: OUTPUT_WRITE.
 */
static void writeStdout(const void* p,size_t n){DWORD used=0;need(WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),p,(DWORD)n,&used,nullptr)&&used==n,"OUTPUT_WRITE");}
/**
 * 中文：重检源后非阻塞连接固定回环端口，验证连接错误并返回本地客户端端口。
 * English: Rechecks the source, connects nonblockingly to the pinned loopback port, verifies connection errors and returns the local client port.
 * 参数 / Parameters: `connectBare(Source& source,Sock& sock)`.
 * 拒绝码 / Refusal codes: SOCKET_CREATE, SOCKET_CONNECT, SOCKET_LOCAL.
 */
static uint16_t connectBare(Source& source,Sock& sock) {
  source.check();sock.v=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);need(sock.v!=INVALID_SOCKET,"SOCKET_CREATE");
  sockaddr_in addr{};addr.sin_family=AF_INET;addr.sin_addr.s_addr=htonl(INADDR_LOOPBACK);addr.sin_port=htons(source.port);u_long nonblocking=1;ioctlsocket(sock.v,FIONBIO,&nonblocking);int rc=connect(sock.v,(sockaddr*)&addr,sizeof addr);need(rc==0||WSAGetLastError()==WSAEWOULDBLOCK,"SOCKET_CONNECT");auto deadline=Clock::now()+std::chrono::seconds(3);waitSocket(sock.v,true,deadline);int error=0;int el=sizeof error;need(getsockopt(sock.v,SOL_SOCKET,SO_ERROR,(char*)&error,&el)==0&&error==0,"SOCKET_CONNECT");
  sockaddr_in local{};int al=sizeof local;need(getsockname(sock.v,(sockaddr*)&local,&al)==0,"SOCKET_LOCAL");return ntohs(local.sin_port);
}
struct AssuanLineShape {
  size_t length=0;std::array<char,2> prefix{};
  /**
   * 中文：跨分块检查 Assuan 行长和前缀，只允许 D-space 数据行含原始 NUL。
   * English: Checks Assuan line length/prefix across chunks, allowing raw NUL only in D-space data lines.
   * 参数 / Parameters: `feed(const char* bytes,size_t count)`.
   * 拒绝码 / Refusal codes: ASSUAN_NUL, ASSUAN_LINE_SIZE.
   */
  void feed(const char* bytes,size_t count) {
    for(size_t i=0;i<count;i++) {
      if(bytes[i]=='\n'){length=0;prefix={};continue;}
      if(length<2)prefix[length]=bytes[i];
      // Assuan D payloads are binary. Only the exact D-space prefix permits
      // a raw NUL; command, status, inquiry and close-control bytes do not.
      need(bytes[i]!='\0'||(length>=2&&prefix[0]=='D'&&prefix[1]==' '),"ASSUAN_NUL");
      need(++length<1000,"ASSUAN_LINE_SIZE");
    }
  }
};
struct TerminalState {
  bool byeCandidate=false,closing=false,acknowledged=false;
  std::string inputLine,replyBytes;AssuanLineShape inputShape;
  /**
   * 中文：识别完整 BYE 行并要求它是本批最后输入，拒绝进入关闭阶段后的额外输入。
   * English: Recognizes a complete BYE line and requires it to end the batch, refusing additional input after closing begins.
   * 参数 / Parameters: `input(const char* bytes,size_t count)`.
   * 拒绝码 / Refusal codes: POST_BYE_INPUT, ASSUAN_LINE_SIZE.
   */
  bool input(const char* bytes,size_t count) {
    need(!closing,"POST_BYE_INPUT");bool candidate=false;
    for(size_t i=0;i<count;i++) {
      inputShape.feed(bytes+i,1);inputLine+=bytes[i];need(inputLine.size()<1000,"ASSUAN_LINE_SIZE");
      if(bytes[i]=='\n') {
        if(inputLine=="BYE\n"||inputLine=="BYE\r\n") {need(!byeCandidate&&i+1==count,"POST_BYE_INPUT");byeCandidate=true;candidate=true;}
        inputLine.clear();
      }
    }
    return candidate;
  }
  /**
   * 中文：仅在源、活进程和连接四元组已验证后提交 BYE 关闭状态。
   * English: Commits BYE closing state only after source, live process and connection tuple have been verified.
   * 参数 / Parameters: `begin(bool alreadyVerifiedSourceLiveProcessAndEstablishedTuple)`.
   * 拒绝码 / Refusal codes: BYE_AUTHORIZATION, BYE_STATE.
   */
  void begin(bool alreadyVerifiedSourceLiveProcessAndEstablishedTuple) {
    need(alreadyVerifiedSourceLiveProcessAndEstablishedTuple,"BYE_AUTHORIZATION");
    need(byeCandidate&&!closing,"BYE_STATE");closing=true;
  }
  /**
   * 中文：在关闭阶段仅接受精确公开 OK closing connection 回执，拒绝 NUL、额外行和超长数据。
   * English: Accepts only the exact public OK closing connection receipt during closing, refusing NUL, extra lines and excess bytes.
   * 参数 / Parameters: `terminal(const char* bytes,size_t count)`.
   * 拒绝码 / Refusal codes: BYE_REPLY_STATE, ASSUAN_NUL, BYE_REPLY_BUDGET, BYE_REPLY_FRAME.
   */
  bool terminal(const char* bytes,size_t count) {
    need(closing&&!acknowledged,"BYE_REPLY_STATE");
    for(size_t i=0;i<count;i++)need(bytes[i]!='\0',"ASSUAN_NUL");
    replyBytes.append(bytes,count);need(replyBytes.size()<1000,"BYE_REPLY_BUDGET");
    if(replyBytes.find('\n')==std::string::npos)return false;
    // After authenticated BYE this branch handles only the public close receipt.
    // It cannot carry signing/decryption data, status, inquiries, or more input.
    need(replyBytes=="OK closing connection\n"||replyBytes=="OK closing connection\r\n","BYE_REPLY_FRAME");
    acknowledged=true;return true;
  }
};
/**
 * 中文：真实关闭 socket、清空其所有权并输出不含载荷的关闭事件。
 * English: Physically closes the socket, clears its ownership and emits a payload-free closure event.
 * 参数 / Parameters: `closeSource(Sock& sock,const char* reason,size_t total)`.
 * 拒绝码 / Refusal codes: SOCKET_CLOSE.
 */
static void closeSource(Sock& sock,const char* reason,size_t total) {
  need(closesocket(sock.v)==0,"SOCKET_CLOSE");sock.v=INVALID_SOCKET;
  event("{\"event\":\"CLOSED\",\"bytesForwarded\":"+std::to_string(total)+",\"reason\":"+jq(reason)+",\"physicalSocketClose\":true,\"closeResult\":0}");
}
/**
 * 中文：要求当前监听者及已接受连接的 PID 都等于连接前固定的原创建者。
 * English: Requires both listener and accepted-connection PIDs to match the original creator pinned before connecting.
 * 参数 / Parameters: `requireOriginalCreator(DWORD original,DWORD observedListener,DWORD observedAcceptedPeer)`.
 * 拒绝码 / Refusal codes: TCP_CREATOR_PIN_ABSENT, TCP_LISTENER_CHANGED, TCP_CREATOR_PEER_MISMATCH.
 */
static void requireOriginalCreator(DWORD original,DWORD observedListener,DWORD observedAcceptedPeer) {
  need(original!=0,"TCP_CREATOR_PIN_ABSENT");
  need(observedListener==original,"TCP_LISTENER_CHANGED");
  need(observedAcceptedPeer==original,"TCP_CREATOR_PEER_MISMATCH");
}
/**
 * 中文：重检源与创建者进程并确认端口监听权未变。
 * English: Rechecks the source/creator and confirms unchanged listener ownership.
 * 参数 / Parameters: `creatorOwner(Source& source,Process& process)`.
 * 拒绝码 / Refusal codes: TCP_LISTENER_CHANGED.
 */
static void creatorOwner(Source& source,Process& process) {
  source.check();process.check();need(listener(source.port)==process.pid,"TCP_LISTENER_CHANGED");
  process.check();source.check();
}
/**
 * 中文：重检源与进程，要求监听者、已接受对端及精确连接四元组都匹配原创建者。
 * English: Rechecks source/process and requires listener, accepted peer and exact tuple to match the original creator.
 * 参数 / Parameters: `activeOwner(Source& source,Process& process,uint16_t client)`.
 * 拒绝码 / Refusal codes: TCP_PEER_CHANGED.
 */
static void activeOwner(Source& source,Process& process,uint16_t client) {
  source.check();process.check();
  requireOriginalCreator(process.pid,listener(source.port),accepted(source.port,client));
  need(tuple(source.port,client,process.pid),"TCP_PEER_CHANGED");
  process.check();source.check();
}

// Strict, bounded metadata JSON. Byte-stream Assuan payloads are never parsed as JSON.
struct Json {
  enum Type {Null,Bool,Number,String,Array,Object} type=Null;
  bool flag=false;uint64_t number=0;std::string text;std::vector<Json> list;std::map<std::string,Json> fields;
  /**
   * 中文：从对象取得必需字段引用，非对象或缺少字段抛出请求错误。
   * English: Returns a required object field by reference, throwing a request error for nonobjects or missing fields.
   * 参数 / Parameters: `& at(const std::string& key)const`.
   * 拒绝码 / Refusal codes: REQUEST_OBJECT, REQUEST_FIELD.
   */
  const Json& at(const std::string& key)const{need(type==Object,"REQUEST_OBJECT");auto i=fields.find(key);need(i!=fields.end(),"REQUEST_FIELD");return i->second;}
  /**
   * 中文：取得字符串值，其他 JSON 类型拒绝。
   * English: Returns a string value, refusing other JSON types.
   * 参数 / Parameters: `str()const`.
   * 拒绝码 / Refusal codes: REQUEST_STRING.
   */
  std::string str()const{need(type==String,"REQUEST_STRING");return text;}
  /**
   * 中文：取得无符号整数值，其他 JSON 类型拒绝。
   * English: Returns an unsigned integer value, refusing other JSON types.
   * 参数 / Parameters: `integer()const`.
   * 拒绝码 / Refusal codes: REQUEST_NUMBER.
   */
  uint64_t integer()const{need(type==Number,"REQUEST_NUMBER");return number;}
  /**
   * 中文：递归输出稳定 JSON 表示，对象按 map 键顺序输出，供上下文和固定摘要比较。
   * English: Recursively emits stable JSON with map-ordered object keys for context and pin-hash comparisons.
   * 参数 / Parameters: `canonical()const`.
   */
  std::string canonical()const{switch(type){case Null:return "null";case Bool:return flag?"true":"false";case Number:return std::to_string(number);case String:return jq(text);case Array:{std::string out="[";for(const auto& item:list){if(out.size()>1)out+=",";out+=item.canonical();}return out+"]";}case Object:{std::string out="{";for(const auto& item:fields){if(out.size()>1)out+=",";out+=jq(item.first)+":"+item.second.canonical();}return out+"}";}}throw std::runtime_error("REQUEST_JSON");}
};
struct JsonParser {
  const std::string& bytes;size_t at=0;
  /**
   * 中文：只跳过 JSON 允许的四种空白字节。
   * English: Skips only the four whitespace bytes permitted by JSON.
   * 参数 / Parameters: `space()`.
   */
  void space(){while(at<bytes.size()&&(bytes[at]==' '||bytes[at]=='\n'||bytes[at]=='\r'||bytes[at]=='\t'))at++;}
  /**
   * 中文：读取恰好四个十六进制位构成 Unicode 转义，截断或非法字符拒绝。
   * English: Reads exactly four hexadecimal digits for a Unicode escape, refusing truncation or invalid characters.
   * 参数 / Parameters: `hex()`.
   * 拒绝码 / Refusal codes: REQUEST_ESCAPE.
   */
  unsigned hex(){need(at+4<=bytes.size(),"REQUEST_ESCAPE");unsigned n=0;for(int i=0;i<4;i++){char c=bytes[at++];need((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F'),"REQUEST_ESCAPE");n=n*16+(c<='9'?c-'0':(c>='a'?c-'a':c-'A')+10);}return n;}
  /**
   * 中文：解析 JSON 字符串与转义，要求合法代理对并拒绝控制字符或未闭合字符串。
   * English: Parses JSON strings/escapes, requiring valid surrogate pairs and refusing controls or unterminated strings.
   * 参数 / Parameters: `string()`.
   * 拒绝码 / Refusal codes: REQUEST_STRING, REQUEST_CONTROL, REQUEST_ESCAPE, REQUEST_SURROGATE, REQUEST_STRING_END.
   */
  std::string string(){need(at<bytes.size()&&bytes[at++]=='"',"REQUEST_STRING");std::string out;bool done=false;while(at<bytes.size()){unsigned char c=bytes[at++];if(c=='"'){done=true;break;}need(c>=32,"REQUEST_CONTROL");if(c!='\\'){out+=c;continue;}need(at<bytes.size(),"REQUEST_ESCAPE");char e=bytes[at++];if(e=='"'||e=='\\'||e=='/')out+=e;else if(e=='b')out+='\b';else if(e=='f')out+='\f';else if(e=='n')out+='\n';else if(e=='r')out+='\r';else if(e=='t')out+='\t';else if(e=='u'){unsigned cp=hex();std::wstring wide;if(cp>=0xd800&&cp<=0xdbff){need(at+2<=bytes.size()&&bytes[at]=='\\'&&bytes[at+1]=='u',"REQUEST_SURROGATE");at+=2;unsigned low=hex();need(low>=0xdc00&&low<=0xdfff,"REQUEST_SURROGATE");wide+=(wchar_t)cp;wide+=(wchar_t)low;}else{need(cp<0xdc00||cp>0xdfff,"REQUEST_SURROGATE");wide+=(wchar_t)cp;}out+=utf8(wide);}else throw std::runtime_error("REQUEST_ESCAPE");}need(done,"REQUEST_STRING_END");return out;}
  /**
   * 中文：递归解析有界深度 JSON，拒绝重复键、无符号整数溢出和不支持的数值格式。
   * English: Recursively parses depth-bounded JSON, refusing duplicate keys, unsigned overflow and unsupported numeric forms.
   * 参数 / Parameters: `value(unsigned depth=0)`.
   * 拒绝码 / Refusal codes: REQUEST_DEPTH, REQUEST_EOF, REQUEST_COLON, REQUEST_DUPLICATE, REQUEST_DELIMITER, REQUEST_INTEGER, REQUEST_LITERAL.
   */
  Json value(unsigned depth=0){need(depth<16,"REQUEST_DEPTH");space();need(at<bytes.size(),"REQUEST_EOF");Json out;char c=bytes[at];if(c=='"'){out.type=Json::String;out.text=string();}else if(c=='{'||c=='['){bool object=c=='{';at++;out.type=object?Json::Object:Json::Array;space();char end=object?'}':']';if(at<bytes.size()&&bytes[at]==end){at++;return out;}for(;;){space();std::string key;if(object){key=string();space();need(at<bytes.size()&&bytes[at++]==':',"REQUEST_COLON");}Json item=value(depth+1);if(object)need(out.fields.emplace(key,std::move(item)).second,"REQUEST_DUPLICATE");else out.list.push_back(std::move(item));space();need(at<bytes.size(),"REQUEST_EOF");char delimiter=bytes[at++];if(delimiter==end)break;need(delimiter==',',"REQUEST_DELIMITER");}}else if(c>='0'&&c<='9'){out.type=Json::Number;size_t start=at;while(at<bytes.size()&&bytes[at]>='0'&&bytes[at]<='9'){need(out.number<=((UINT64_MAX-9)/10),"REQUEST_INTEGER");out.number=out.number*10+(bytes[at++]-'0');}need(at-start==1||bytes[start]!='0',"REQUEST_INTEGER");}else{
  /**
   * 中文：按当前位置匹配 true、false 或 null，仅完整匹配后推进解析偏移。
   * English: Matches true, false or null at the current position, advancing only after an exact match.
   * 参数 / Parameters: `(const char* word)`.
   */
  auto literal=[&](const char* word){size_t size=strlen(word);if(bytes.compare(at,size,word)!=0)return false;at+=size;return true;};if(literal("true")){out.type=Json::Bool;out.flag=true;}else if(literal("false")){out.type=Json::Bool;}else need(literal("null"),"REQUEST_LITERAL");}return out;}
  /**
   * 中文：解析单个值并跳过尾部合法空白，拒绝多余字节。
   * English: Parses one value and skips legal trailing whitespace, refusing extra bytes.
   * 参数 / Parameters: `parse()`.
   * 拒绝码 / Refusal codes: REQUEST_TRAILING.
   */
  Json parse(){Json result=value();space();need(at==bytes.size(),"REQUEST_TRAILING");return result;}
};
/**
 * 中文：从完整元数据文本建立严格 JSON 解析器并返回根值。
 * English: Builds the strict parser over complete metadata text and returns its root value.
 * 参数 / Parameters: `parseJson(const std::string& text)`.
 */
static Json parseJson(const std::string& text){return JsonParser{text}.parse();}
/**
 * 中文：严格将请求 UTF-8 路径转换为 Windows UTF-16，非法字节拒绝。
 * English: Strictly converts a request UTF-8 path to Windows UTF-16, refusing invalid bytes.
 * 参数 / Parameters: `wide(const std::string& value)`.
 * 拒绝码 / Refusal codes: REQUEST_UTF8.
 */
static std::wstring wide(const std::string& value){int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),(int)value.size(),nullptr,0);need(count>0,"REQUEST_UTF8");std::wstring out(count,L'\0');need(MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),(int)value.size(),out.data(),count)==count,"REQUEST_UTF8");return out;}
/**
 * 中文：从控制 stdin 精确读取指定长度，管道 EOF 或读取失败立即拒绝。
 * English: Reads an exact byte count from control stdin, refusing pipe EOF or read failure.
 * 参数 / Parameters: `readInput(void* buffer,size_t size)`.
 * 拒绝码 / Refusal codes: CONTROL_EOF.
 */
static void readInput(void* buffer,size_t size){char* to=(char*)buffer;while(size){DWORD used=0;need(ReadFile(GetStdHandle(STD_INPUT_HANDLE),to,(DWORD)size,&used,nullptr)&&used>0,"CONTROL_EOF");to+=used;size-=used;}}
/**
 * 中文：读取四字节大端长度和有界 JSON 主体，要求 1 到 65536 字节。
 * English: Reads a four-byte big-endian length and bounded JSON body, requiring 1 to 65536 bytes.
 * 参数 / Parameters: `request()`.
 * 拒绝码 / Refusal codes: REQUEST_SIZE.
 */
static Json request(){unsigned char header[4];readInput(header,4);uint32_t count=((uint32_t)header[0]<<24)|((uint32_t)header[1]<<16)|((uint32_t)header[2]<<8)|header[3];need(count>0&&count<=65536,"REQUEST_SIZE");std::string body(count,'\0');readInput(body.data(),body.size());return parseJson(body);}
/**
 * 中文：查询进程快照中当前进程的直接父 PID，未找到或查询失败拒绝。
 * English: Finds this process's direct parent PID in a process snapshot, refusing absence/query failure.
 * 参数 / Parameters: `parentPid()`.
 * 拒绝码 / Refusal codes: PARENT_SNAPSHOT.
 */
static DWORD parentPid(){Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0));need(snapshot.v!=INVALID_HANDLE_VALUE,"PARENT_SNAPSHOT");PROCESSENTRY32W entry{};entry.dwSize=sizeof entry;need(Process32FirstW(snapshot.v,&entry),"PARENT_SNAPSHOT");do{if(entry.th32ProcessID==GetCurrentProcessId())return entry.th32ParentProcessID;}while(Process32NextW(snapshot.v,&entry));throw std::runtime_error("PARENT_ABSENT");}
/**
 * 中文：序列化已固定的后代文件身份数组。
 * English: Serializes the pinned descendant-file identity array.
 * 参数 / Parameters: `listInfo(const std::vector<FileInfo>& infos)`.
 */
static std::string listInfo(const std::vector<FileInfo>& infos){std::string out="[";for(const auto& item:infos){if(out.size()>1)out+=",";out+=json(item);}return out+"]";}
/**
 * 中文：组合锚点、后代、源摘要、端口和创建者身份，供控制器完整快照比较。
 * English: Combines anchor, descendants, source hash, port and creator identity for controller snapshot comparisons.
 * 参数 / Parameters: `sourcePins(Source& source,Process& process,const std::wstring& relative)`.
 */
static std::string sourcePins(Source& source,Process& process,const std::wstring& relative){return "{\"kind\":\"w32\",\"anchorPath\":"+jq(utf8(source.anchor.path))+",\"relativePath\":"+jq(utf8(relative))+",\"anchor\":"+json(source.anchor.originals.back())+",\"ancestors\":"+source.anchor.jsonAll()+",\"descendants\":"+listInfo(source.originals)+",\"sourceFileSha256\":"+jq(source.digest)+",\"port\":"+std::to_string(source.port)+",\"process\":"+process.jsonSelf()+"}";}
/**
 * 中文：沿源路径父级寻找同用户且保护 DACL 的私有目录，其他安全错误不继续尝试。
 * English: Ascends source-path parents to find a same-user protected-DACL directory, stopping on other security errors.
 * 参数 / Parameters: `discoverAnchor(const std::wstring& filename)`.
 * 拒绝码 / Refusal codes: SOURCE_FORMAT_UNSUPPORTED, SOURCE_COMPONENTS, SOURCE_OWNER_OR_ACL, SOURCE_PRIVATE_ANCHOR_ABSENT.
 */
static std::pair<std::wstring,std::wstring> discoverAnchor(const std::wstring& filename){need(filename.size()>3&&iswalpha(filename[0])&&filename[1]==L':'&&filename[2]==L'\\',"SOURCE_FORMAT_UNSUPPORTED");auto parts=split(filename.substr(3));need(parts.size()>=2&&parts.size()<=64,"SOURCE_COMPONENTS");std::wstring parent=filename.substr(0,filename.find_last_of(L'\\'));for(;;){try{Anchor anchor(parent);return {parent,filename.substr(parent.size()+1)};}catch(const std::runtime_error& error){std::string code=error.what();need(code=="SOURCE_OWNER_OR_ACL"||code=="ANCHOR_DACL_NOT_PROTECTED","SOURCE_ANCHOR_REFUSED");}size_t slash=parent.find_last_of(L'\\');need(slash>2,"SOURCE_PRIVATE_ANCHOR_ABSENT");parent.resize(slash);} }
static Handle executableFile;
/**
 * 中文：打开并保持当前 helper 映像，匹配请求中的尺寸/摘要并复核文件身份。
 * English: Opens/holds the current helper image, matches requested size/hash and rechecks its file identity.
 * 参数 / Parameters: `helperAsset(Process& process,const Json& input)`.
 * 拒绝码 / Refusal codes: HELPER_IMAGE_OPEN, HELPER_IMAGE_TYPE, HELPER_IMAGE_SIZE, HELPER_IMAGE_READ, HELPER_IMAGE_HASH.
 */
static std::string helperAsset(Process& process,const Json& input){
  executableFile=Handle(CreateFileW(wide(process.image).c_str(),GENERIC_READ|READ_CONTROL,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));need(executableFile.v!=INVALID_HANDLE_VALUE,"HELPER_IMAGE_OPEN");auto pinned=info(executableFile.v,false);need(!pinned.directory&&pinned.links==1,"HELPER_IMAGE_TYPE");LARGE_INTEGER length{};need(GetFileSizeEx(executableFile.v,&length)&&length.QuadPart>0&&length.QuadPart<=16777216&&length.QuadPart==(LONGLONG)input.at("helperSize").integer(),"HELPER_IMAGE_SIZE");std::vector<unsigned char> bytes((size_t)length.QuadPart);DWORD used=0;need(ReadFile(executableFile.v,bytes.data(),(DWORD)bytes.size(),&used,nullptr)&&used==bytes.size(),"HELPER_IMAGE_READ");auto digest=hash(bytes.data(),bytes.size());need(digest==input.at("helperSha256").str()&&jsonComparable(pinned,info(executableFile.v,false)),"HELPER_IMAGE_HASH");return "{\"file\":"+json(pinned)+",\"sha256\":"+jq(digest)+",\"size\":"+std::to_string(bytes.size())+"}";
}
/**
 * 中文：从已固定句柄读取有界完整 JSON 并验证摘要，用于出生记录和租约意图。
 * English: Reads bounded complete JSON from a held handle and verifies its hash for birth records and lease intent.
 * 参数 / Parameters: `readHeldJson(HANDLE handle)`.
 * 拒绝码 / Refusal codes: BIRTH_SIZE, BIRTH_READ.
 */
static std::string readHeldJson(HANDLE handle){LARGE_INTEGER length{};need(GetFileSizeEx(handle,&length)&&length.QuadPart>0&&length.QuadPart<=65536,"BIRTH_SIZE");std::string bytes((size_t)length.QuadPart,'\0');DWORD used=0;need(ReadFile(handle,bytes.data(),(DWORD)bytes.size(),&used,nullptr)&&used==bytes.size(),"BIRTH_READ");return bytes;}
/**
 * 中文：验证私有出生记录、当前进程与 helper 身份、上下文和源固定摘要及租约意图。
 * English: Validates the private birth record, current process/helper identity, context/source-pin digest and lease intent.
 * 参数 / Parameters: `verifyBirth(const Json& permit,const Json& input,Process& self,Process& parent)`.
 * 拒绝码 / Refusal codes: BIRTH_NAME, BIRTH_IDENTITY, BIRTH_HASH, BIRTH_PROCESS, BIRTH_CONTEXT, BIRTH_DIGEST, BIRTH_SNAPSHOT_DIGEST, LEASE_INTENT_TYPE, LEASE_INTENT_CONTEXT, LEASE_INTENT_HELPER, BIRTH_CHANGED.
 * 设计 / Design: 源连接和 nonce 发送之前完成全部固定校验，防止凭据发送给替换进程或未授权 helper。
 * Completes all pin checks before connecting to the source or sending its nonce, preventing credential delivery to replaced processes or unauthorized helpers.
 */
static void verifyBirth(const Json& permit,const Json& input,Process& self,Process& parent){
  Anchor root(wide(permit.at("birthRoot").str()),permit.at("birthRootId").str());
  auto filename=wide(permit.at("relative").str());need(filename.size()==41&&filename.substr(36)==L".json","BIRTH_NAME");
  Handle leaf=openChild(root.handles.back().v,filename,true);auto pin=info(leaf.v,true);need(!pin.directory&&pin.links==1&&pin.id==permit.at("fileId").str(),"BIRTH_IDENTITY");auto bytes=readHeldJson(leaf.v);need(hash(bytes.data(),bytes.size())==permit.at("sha256").str(),"BIRTH_HASH");Json birth=parseJson(bytes);
  need(birth.at("pid").integer()==self.pid&&birth.at("creationTime").str()==std::to_string(self.created)&&birth.at("sid").str()==self.sidValue&&birth.at("image").str()==self.image,"BIRTH_PROCESS");
  need(birth.at("context").canonical()==permit.at("context").canonical()&&birth.at("context").canonical()==input.at("context").canonical(),"BIRTH_CONTEXT");
  need(birth.at("hostSourceSha256").str()==permit.at("hostSourceSha256").str()&&birth.at("hostHelperSha256").str()==input.at("helperSha256").str(),"BIRTH_DIGEST");
  Json body;body.type=Json::Object;body.fields["version"]=input.at("version");body.fields["pins"]=input.at("pins");Json digest;digest.type=Json::String;digest.text=input.at("helperSha256").str();body.fields["hostHelperSha256"]=digest;auto canonical=body.canonical();need(hash(canonical.data(),canonical.size())==permit.at("hostSourceSha256").str(),"BIRTH_SNAPSHOT_DIGEST");
  Handle intentFile=openChild(root.handles.back().v,L"lease-intent.json",true);auto intentPin=info(intentFile.v,true);need(!intentPin.directory&&intentPin.links==1,"LEASE_INTENT_TYPE");auto intent=parseJson(readHeldJson(intentFile.v));need(intent.at("version").integer()==1&&intent.at("context").canonical()==input.at("context").canonical()&&intent.at("parent").canonical()==parseJson(parent.jsonSelf()).canonical(),"LEASE_INTENT_CONTEXT");
  need(intent.at("hostHelperSha256").str()==input.at("helperSha256").str(),"LEASE_INTENT_HELPER");self.check();parent.check();root.check();need(jsonComparable(pin,info(leaf.v,true)),"BIRTH_CHANGED");event("{\"event\":\"BIRTH_VERIFIED\",\"beforeSourceConnect\":true,\"beforeNonce\":true}");
}
// nonce 属于敏感握手数据；先核实源创建进程与已建立 TCP tuple，再发送，不能只根据端口号放行。
/**
 * 中文：连接前固定创建者，连接后核对监听者和四元组，再发送 nonce 并验证受限 Assuan 握手。
 * English: Pins the creator before connecting, checks listener/tuple after connection, then sends the nonce and validates a restricted Assuan handshake.
 * 参数 / Parameters: `handshake(Source& source,Process& process,Process& parent,Sock& socket,uint16_t& client)`.
 * 拒绝码 / Refusal codes: OK, ASSUAN_PROBE_BUDGET.
 */
static std::string handshake(Source& source,Process& process,Process& parent,Sock& socket,uint16_t& client){parent.check();creatorOwner(source,process);event("{\"event\":\"CREATOR_PINNED_BEFORE_CONNECT\",\"process\":"+process.jsonSelf()+",\"listenerCreatorPid\":"+std::to_string(process.pid)+",\"nonceSent\":false}");client=connectBare(source,socket);auto deadline=Clock::now()+std::chrono::seconds(3);while(!tuple(source.port,client,process.pid)&&Clock::now()<deadline){parent.check();std::this_thread::sleep_for(std::chrono::milliseconds(20));}activeOwner(source,process,client);parent.check();
  event("{\"event\":\"SOURCE_ATTESTED_BEFORE_NONCE\",\"process\":"+process.jsonSelf()+",\"listenerCreatorPid\":"+std::to_string(process.pid)+",\"clientPort\":"+std::to_string(client)+",\"sourcePort\":"+std::to_string(source.port)+",\"nonceSent\":false}");activeOwner(source,process,client);parent.check();sendAll(socket.v,source.secret.data(),16,deadline);event("{\"event\":\"NONCE_SENT\",\"bytes\":16,\"nonceValueLogged\":false}");
  auto probeDeadline=Clock::now()+std::chrono::seconds(5);std::string greeting=readLine(socket.v,probeDeadline);need(greeting.rfind("OK",0)==0&&(greeting.size()==3||greeting[2]==' '),"ASSUAN_GREETING");activeOwner(source,process,client);parent.check();const char probe[]="GETINFO restricted\n";sendAll(socket.v,probe,sizeof probe-1,probeDeadline);size_t comments=0;for(;;){auto reply=readLine(socket.v,probeDeadline);parent.check();activeOwner(source,process,client);if(reply[0]=='#'){need(++comments<=8,"ASSUAN_PROBE_BUDGET");continue;}need(reply.rfind("OK",0)==0&&(reply.size()==3||reply[2]==' '),"SOURCE_NOT_RESTRICTED");break;}return greeting;
}
/**
 * 中文：发送 BYE 并只接受规范关闭回执及真实 TCP EOF，额外尾字节拒绝。
 * English: Sends BYE and accepts only a canonical close receipt followed by real TCP EOF, refusing trailing bytes.
 * 参数 / Parameters: `terminalClose(Source& source,Process& process,Process& parent,Sock& socket,uint16_t client,size_t total)`.
 * 拒绝码 / Refusal codes: BYE_REPLY_FRAME, POST_BYE_FRAME.
 */
static void terminalClose(Source& source,Process& process,Process& parent,Sock& socket,uint16_t client,size_t total){activeOwner(source,process,client);parent.check();const char bye[]="BYE\n";auto deadline=Clock::now()+std::chrono::seconds(5);sendAll(socket.v,bye,sizeof bye-1,deadline);auto reply=readLine(socket.v,deadline);creatorOwner(source,process);parent.check();need(reply=="OK closing connection\n"||reply=="OK closing connection\r\n","BYE_REPLY_FRAME");waitSocket(socket.v,false,deadline);char trailing;need(recv(socket.v,&trailing,1,0)==0,"POST_BYE_FRAME");closeSource(socket,"capture-complete",total);}
/**
 * 中文：在控制端、源及创建者持续验证下转发完整 Assuan 行，限制总字节和会话时长。
 * English: Forwards complete Assuan lines while continuously validating control, source and creator, with total-byte/session-time limits.
 * 参数 / Parameters: `runRelay(Source& source,Process& process,Process& parent,const std::wstring& relative,unsigned seconds,bool capture)`.
 * 拒绝码 / Refusal codes: INPUT_PEEK, INPUT_READ, ASSUAN_TOTAL_BUDGET, ASSUAN_LINE_SIZE, SOCKET_SELECT, SOCKET_READ, ASSUAN_INCOMPLETE_FRAME, POST_BYE_FRAME.
 * 设计 / Design: BYE 先重验身份再进入仅关闭回执状态，直到真实 EOF；失败路径实际关闭 socket 并输出控制事件，不记录载荷。
 * BYE revalidates identity before entering receipt-only closing until real EOF; failures physically close the socket and emit control events without logging payloads.
 */
static void runRelay(Source& source,Process& process,Process& parent,const std::wstring& relative,unsigned seconds,bool capture){Sock socket;size_t total=0;try{uint16_t client=0;auto greeting=handshake(source,process,parent,socket,client);event("{\"event\":\"READY\",\"restricted\":true,\"helper\":"+Process(GetCurrentProcessId()).jsonSelf()+"}");if(capture){event("{\"event\":\"CAPTURED\",\"pins\":"+sourcePins(source,process,relative)+"}");terminalClose(source,process,parent,socket,client,total);return;}writeStdout(greeting.data(),greeting.size());auto end=Clock::now()+std::chrono::seconds(seconds);AssuanLineShape serverShape;TerminalState terminal;std::string serverPending,clientPending;
  while(Clock::now()<end){parent.check();creatorOwner(source,process);DWORD available=0;BOOL peek=PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE),nullptr,0,nullptr,&available,nullptr);if(!peek){need(GetLastError()==ERROR_BROKEN_PIPE,"INPUT_PEEK");closeSource(socket,"caller-eof",total);return;}if(available){std::array<char,4096> buffer{};DWORD used=0;need(ReadFile(GetStdHandle(STD_INPUT_HANDLE),buffer.data(),std::min<DWORD>(available,buffer.size()),&used,nullptr)&&used>0,"INPUT_READ");bool bye=terminal.input(buffer.data(),used);need((total+=used)<=1048576,"ASSUAN_TOTAL_BUDGET");clientPending.append(buffer.data(),used);size_t lf;while((lf=clientPending.find('\n'))!=std::string::npos){activeOwner(source,process,client);parent.check();sendAll(socket.v,clientPending.data(),lf+1,end);clientPending.erase(0,lf+1);}need(clientPending.size()<1000,"ASSUAN_LINE_SIZE");if(bye){terminal.begin(true);event("{\"event\":\"BYE_SENT\",\"newRequestsForbidden\":true}");}}
    fd_set readable;FD_ZERO(&readable);FD_SET(socket.v,&readable);timeval timeout{0,20000};int selected=select(0,&readable,nullptr,nullptr,&timeout);need(selected>=0,"SOCKET_SELECT");if(!selected)continue;std::array<char,4096> buffer{};int used=recv(socket.v,buffer.data(),buffer.size(),0);need(used>=0,"SOCKET_READ");if(!used){need(serverPending.empty(),"ASSUAN_INCOMPLETE_FRAME");closeSource(socket,"source-eof",total);return;}need((total+=used)<=1048576,"ASSUAN_TOTAL_BUDGET");if(terminal.closing){creatorOwner(source,process);parent.check();if(!terminal.terminal(buffer.data(),used))continue;writeStdout(terminal.replyBytes.data(),terminal.replyBytes.size());event("{\"event\":\"BYE_RECEIPT\",\"canonicalTerminalControlOnly\":true}");auto deadline=Clock::now()+std::chrono::seconds(5);waitSocket(socket.v,false,deadline);char trailing;need(recv(socket.v,&trailing,1,0)==0,"POST_BYE_FRAME");closeSource(socket,"authenticated-bye-eof",total);return;}
    serverShape.feed(buffer.data(),used);serverPending.append(buffer.data(),used);size_t lf;while((lf=serverPending.find('\n'))!=std::string::npos){activeOwner(source,process,client);parent.check();writeStdout(serverPending.data(),lf+1);serverPending.erase(0,lf+1);}need(serverPending.size()<1000,"ASSUAN_LINE_SIZE");
  }throw std::runtime_error("ASSUAN_DEADLINE");
}catch(...){if(socket.v!=INVALID_SOCKET)closeSource(socket,"relay-error",total);throw;}}
/**
 * 中文：只观察原进程出生标识是否已结束或 PID 被重用，活进程继续核对映像/SID，绝不终止进程。
 * English: Observes whether the original birth ended or its PID was reused, rechecking image/SID when live and never terminating it.
 * 参数 / Parameters: `deadCheck(const Json& expected)`.
 * 拒绝码 / Refusal codes: HELPER_IMAGE_MISMATCH, HELPER_PID, HELPER_DEATH_UNKNOWN, HELPER_IDENTITY_MISMATCH.
 */
static void deadCheck(const Json& expected){Process self(GetCurrentProcessId());need(expected.at("image").str()==self.image,"HELPER_IMAGE_MISMATCH");uint64_t value=expected.at("pid").integer();need(value>0&&value<=UINT32_MAX,"HELPER_PID");DWORD pid=(DWORD)value;Handle handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid));if(!handle.v||handle.v==INVALID_HANDLE_VALUE){need(GetLastError()==ERROR_INVALID_PARAMETER,"HELPER_DEATH_UNKNOWN");event("{\"event\":\"DEAD_CHECK\",\"originalDead\":true,\"reason\":\"original-pid-absent\"}");return;}FILETIME creation{},exit{},kernel{},user{};need(GetProcessTimes(handle.v,&creation,&exit,&kernel,&user),"HELPER_DEATH_UNKNOWN");uint64_t original=std::stoull(expected.at("creationTime").str());if(ticks(creation)!=original){event("{\"event\":\"DEAD_CHECK\",\"originalDead\":true,\"reason\":\"pid-reused\"}");return;}DWORD state=WaitForSingleObject(handle.v,0);need(state==WAIT_OBJECT_0||state==WAIT_TIMEOUT,"HELPER_DEATH_UNKNOWN");if(state==WAIT_TIMEOUT){Process live(pid,original);need(live.sidValue==expected.at("sid").str()&&live.image==expected.at("image").str(),"HELPER_IDENTITY_MISMATCH");}event(std::string("{\"event\":\"DEAD_CHECK\",\"originalDead\":")+(state==WAIT_OBJECT_0?"true":"false")+",\"reason\":\"held-original-process\"}");}
/**
 * 中文：建立二进制控制通道与 Winsock，验证直接父进程/helper 后分派身份、观察、捕获、检查或中继模式。
 * English: Sets up binary control channels/Winsock and validates direct parent/helper before dispatching identity, observation, capture, inspection or relay mode.
 * 参数 / Parameters: `wmain(int argc,wchar_t** argv)`.
 * 拒绝码 / Refusal codes: ARGUMENTS, REQUEST_VERSION, CONTROL_PID, CONTROL_PARENT, CONTROL_PARENT_IMAGE, OPERATION, RUN_BUDGET, SOURCE_SNAPSHOT_CHANGED.
 */
int wmain(int argc,wchar_t** argv){_setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);WSADATA data{};if(WSAStartup(MAKEWORD(2,2),&data)!=0)return 1;try{need(argc==2,"ARGUMENTS");std::wstring operation=argv[1];Json input=request();need(input.at("version").integer()==1,"REQUEST_VERSION");uint64_t controlValue=input.at("parentPid").integer();need(controlValue>0&&controlValue<=UINT32_MAX,"CONTROL_PID");DWORD control=(DWORD)controlValue;need(parentPid()==control,"CONTROL_PARENT");Process parent(control);need(parent.image==input.at("parentImage").str(),"CONTROL_PARENT_IMAGE");controller=&parent;controlEofRequired=operation==L"relay"||operation==L"capture"||operation==L"inspect";Process self(GetCurrentProcessId());auto asset=helperAsset(self,input);event("{\"event\":\"IDENTITY\",\"helper\":"+self.jsonSelf()+",\"parent\":"+parent.jsonSelf()+",\"asset\":"+asset+"}");
  if(operation==L"identity"){WSACleanup();return 0;}if(operation==L"dead-check"){deadCheck(input.at("identity"));WSACleanup();return 0;}
  need(operation==L"capture"||operation==L"inspect"||operation==L"relay","OPERATION");uint64_t timeoutValue=input.at("timeoutSeconds").integer();need(timeoutValue>=1&&timeoutValue<=300,"RUN_BUDGET");unsigned timeout=(unsigned)timeoutValue;std::wstring root,relative;
  if(operation==L"relay"){auto permit=request();verifyBirth(permit,input,self,parent);}
  if(operation==L"relay"){root=wide(input.at("pins").at("anchorPath").str());relative=wide(input.at("pins").at("relativePath").str());}
  else{auto found=discoverAnchor(wide(input.at("path").str()));root=found.first;relative=found.second;}
  Source source(root,relative,"w32");DWORD creator=listener(source.port);Process process(creator);creatorOwner(source,process);
  if(operation==L"relay"){need(parseJson(sourcePins(source,process,relative)).canonical()==input.at("pins").canonical(),"SOURCE_SNAPSHOT_CHANGED");}
  runRelay(source,process,parent,relative,timeout,operation!=L"relay");WSACleanup();return 0;
}catch(const std::exception& error){try{event("{\"event\":\"ERROR\",\"code\":"+jq(error.what())+"}");}catch(...){}WSACleanup();return 1;}}
