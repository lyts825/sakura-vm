/**
 * 中文：Xlib/XCB 注入策略库：固定控制器策略和物理连接身份，按方向、目标和完整内容限制复制粘贴。私有 INCR/MULTIPLE 收集、预算、期限和 fork 隔离共同保证未验证前缀及继承连接不会绕过策略。
 * English: Injected Xlib/XCB policy library: pins controller policy and physical-connection identities and restricts copying/pasting by direction, target and complete content. Private INCR/MULTIPLE collection, budgets, deadlines and fork isolation prevent unvalidated prefixes or inherited connections from bypassing enforcement.
 */
#include "protocol.h"
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xlib-xcb.h>
#include <xcb/xcb.h>
#include <xcb/xcbext.h>
#undef Status
#include <dlfcn.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <sys/socket.h>
#include <pthread.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <poll.h>
#include <regex>
#include <set>
#include <string>
#include <string_view>
#include <tuple>
#include <thread>
#include <vector>

#ifndef SAKURA_CLIPBOARD_BUILD
#error SAKURA_CLIPBOARD_BUILD must identify these source bytes
#endif
namespace {
using sakura::Policy;
using sakura::Flags;
std::string policyPath;
sakura::Status* status=nullptr;
bool configured=false;
std::string brokerDisplay,brokerAuthName,brokerAuthData;
struct Counters {
  std::atomic<size_t> bufferBudget{0},bufferSlots{0},brokerSlots{0};
  std::atomic<bool> shuttingDown{false};
};
/**
 * 中文：取得当前进程状态的原子预算，fork 后继续计入未回收的继承分配。
 * English: Returns atomic accounting in the current process state, retaining charges for unreclaimed inherited allocations after fork.
 */
Counters& accounting();
/**
 * 中文：用原子比较交换预留进程共享字节预算，溢出或超过硬上限时拒绝。
 * English: Reserves process-wide byte budget using atomic compare/exchange, refusing overflow or the hard limit.
 * 参数 / Parameters: `reserveBudget(size_t amount)`.
 */
bool reserveBudget(size_t amount){
  auto used=accounting().bufferBudget.load();for(;;){if(used>sakura::IncrementalBudget||amount>sakura::IncrementalBudget-used)return false;
    if(accounting().bufferBudget.compare_exchange_weak(used,used+amount))return true;}
}
/**
 * 中文：通过 RTLD_NEXT 取得被注入库包装的原始符号，找不到则立即以 126 终止。
 * English: Resolves an intercepted original symbol with RTLD_NEXT and exits with status 126 when unavailable.
 * 参数 / Parameters: `real(const char* name)`.
 */
template<class T> T real(const char* name) {
  auto value=reinterpret_cast<T>(dlsym(RTLD_NEXT,name));
  if (!value) _exit(126);
  return value;
}
// Constant-initialized atomic caches have no C++ initialization guard that a
// vanished thread could leave locked in a no-exec fork child.
/**
 * 中文：以常量初始化原子缓存保存真实符号；无 C++ 初始化守卫，避免 fork 子进程继承已消失线程持有的守卫锁。
 * English: Caches real symbols in constant-initialized atomics without C++ initialization guards, avoiding guards held by vanished threads after fork.
 */
#define CACHED_REAL(variable,name) static std::atomic<decltype(&name)> variable##Cache{nullptr}; \
  auto variable=variable##Cache.load();if(!variable){variable=real<decltype(&name)>(#name);variable##Cache.store(variable);}
/**
 * 中文：为当前包装器取得线程安全缓存的真实原始函数地址。
 * English: Obtains the current wrapper's thread-safe cached original function address.
 */
#define ORIGINAL(name) CACHED_REAL(original,name)
// 已配置进程读取策略失败时保持 Active 且无方向许可，不能因记录丢失退回无约束剪贴板。
/**
 * 中文：读取并校验控制器的固定尺寸策略快照，已配置但读取失败时返回禁止方向的活动策略。
 * English: Reads and validates the controller's fixed-size policy snapshot, returning an active policy with no permitted direction on configured-read failure.
 * 参数 / Parameters: `current()`.
 */
Policy current() {
  Policy value{};
  if (!configured) return value;
  value.flags=sakura::Active;
  const int fd=open(policyPath.c_str(),O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
  if (fd<0) return value;
  struct stat info{};
  Policy read{};
  const bool valid=fstat(fd,&info)==0 && S_ISREG(info.st_mode) && info.st_uid==0 &&
    !(info.st_mode&0022) && info.st_size==sizeof(read) &&
    pread(fd,&read,sizeof(read),0)==sizeof(read) && read.magic==sakura::Magic &&
    read.version==1 && read.flags<=31 && read.maximum>=1024 && read.maximum<=1048576 &&
    read.build[64]==0 && std::strcmp(read.build,SAKURA_CLIPBOARD_BUILD)==0;
  close(fd);
  return valid ? read : value;
}
/**
 * 中文：判断策略是否开启主动限制。
 * English: Tests whether active enforcement is enabled in the policy.
 * 参数 / Parameters: `active(const Policy& rule)`.
 */
bool active(const Policy& rule) { return (rule.flags&sakura::Active)!=0; }
/**
 * 中文：按复制或粘贴方向检查权限；未启用主动限制时允许正常传输。
 * English: Checks permission for copy or paste, allowing ordinary transfer when active enforcement is disabled.
 * 参数 / Parameters: `direction(bool copy,const Policy& rule)`.
 */
bool direction(bool copy,const Policy& rule) {
  return !active(rule) || (rule.flags&(copy?sakura::Copy:sakura::Paste));
}
/**
 * 中文：原子增加共享状态中的复制或粘贴拒绝计数。
 * English: Atomically increments the shared copy- or paste-denial counter.
 * 参数 / Parameters: `blocked(bool copy)`.
 */
void blocked(bool copy) {
  if (status) __atomic_add_fetch(copy?&status->blockedCopy:&status->blockedPaste,1,__ATOMIC_RELAXED);
}
/**
 * 中文：识别私钥、凭据赋值、JWT 和带密码 URL 等敏感文本特征。
 * English: Recognizes sensitive text patterns including private keys, credential assignments, JWTs and password-bearing URLs.
 * 参数 / Parameters: `sensitive(std::string_view text)`.
 */
bool sensitive(std::string_view text) {
  for (size_t start=0;(start=text.find("eyJ",start))!=std::string::npos;) {
    /**
     * 中文：判定字节是否属于 JWT 使用的字母、数字、下划线或连字符集合。
     * English: Tests whether a byte belongs to the JWT alphabet of alphanumerics, underscore or hyphen.
     * 参数 / Parameters: `(unsigned char c)`.
     */
    auto valid=[](unsigned char c){return std::isalnum(c)||c=='_'||c=='-';};
    size_t end=start; while(end<text.size()&&valid(text[end]))++end;
    if (end-start<10 || end==text.size() || text[end]!='.') {start=std::max(start+3,end);continue;}
    size_t middle=++end; while(end<text.size()&&valid(text[end]))++end;
    if (end-middle<10 || end==text.size() || text[end]!='.') {start=end;continue;}
    size_t last=++end; while(end<text.size()&&valid(text[end]))++end;
    if (end-last>=10) return true;
    start=end;
  }
  for (size_t start=0;(start=text.find("://",start))!=std::string::npos;start+=3) {
    const auto begin=start+3;
    auto end=begin;
    while(end<text.size()&&text[end]!='/'&&text[end]!='@'&&!std::isspace(static_cast<unsigned char>(text[end])))++end;
    const auto colon=text.find(':',begin);
    if(end<text.size()&&text[end]=='@'&&colon!=std::string::npos&&colon>begin&&colon<end&&end-colon-1>=6) return true;
  }
  static const std::array<std::regex,4> patterns{
    std::regex("-----BEGIN (?:[A-Z0-9]{1,32} )?PRIVATE KEY-----|PuTTY-User-Key-File-[0-9]{1,8}:"),
    std::regex("\\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255}|xox[baprs]-[A-Za-z0-9-]{20,255}|sk-[A-Za-z0-9_-]{20,255})\\b"),
    std::regex("\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b"),
    std::regex("\\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key)[\"']?\\s{0,128}[:=]\\s{0,128}[\"']?[^\\s\"'`]{12}",std::regex::icase)
  };
  for(const auto& pattern:patterns) if(std::regex_search(text.begin(),text.end(),pattern)) return true;
  return false;
}
/**
 * 中文：将 UTF-16 Windows 字符串严格转换为 UTF-8，编码或 API 失败拒绝。
 * English: Strictly converts a Windows UTF-16 string to UTF-8, refusing encoding/API failures.
 * 参数 / Parameters: `utf8(const unsigned char* data,size_t length)`.
 */
bool utf8(const unsigned char* data,size_t length) {
  for(size_t i=0;i<length;) {
    unsigned c=data[i++];
    if(c<0x80) continue;
    unsigned more=0,code=0,minimum=0;
    if(c>=0xc2&&c<=0xdf){more=1;code=c&31;minimum=0x80;}
    else if(c>=0xe0&&c<=0xef){more=2;code=c&15;minimum=0x800;}
    else if(c>=0xf0&&c<=0xf4){more=3;code=c&7;minimum=0x10000;}
    else return false;
    if(i+more>length) return false;
    while(more--){unsigned next=data[i++];if((next&0xc0)!=0x80)return false;code=(code<<6)|(next&63);}
    if(code<minimum||code>0x10ffff||(code>=0xd800&&code<=0xdfff))return false;
  }
  return true;
}
struct Atoms {
  uint32_t clipboard, targets, timestamp, multiple, incr, manager, save;
  std::array<uint32_t,6> text;
  uint32_t pair;std::array<uint32_t,3> effects;
  /**
   * 中文：判断 atom 是否属于受管理的 CLIPBOARD、PRIMARY 或管理器选择。
   * English: Tests whether an atom names a managed CLIPBOARD, PRIMARY or manager selection.
   * 参数 / Parameters: `selection(uint32_t atom) const`.
   */
  bool selection(uint32_t atom) const { return atom==XA_PRIMARY||atom==clipboard||atom==manager; }
  /**
   * 中文：识别允许按 UTF-8 文本进行检查的目标格式。
   * English: Recognizes target formats that can be inspected as UTF-8 text.
   * 参数 / Parameters: `plain(uint32_t atom) const`.
   */
  bool plain(uint32_t atom) const { return atom && std::find(text.begin(),text.end(),atom)!=text.end(); }
  /**
   * 中文：按当前策略筛选可请求目标，拒绝嵌套 MULTIPLE、INCR 控制和有副作用的目标。
   * English: Filters requestable targets under the policy, rejecting nested MULTIPLE, INCR control and side-effect targets.
   * 参数 / Parameters: `allowed(uint32_t atom,const Policy& rule) const`.
   */
  bool allowed(uint32_t atom,const Policy& rule) const {
    if(!active(rule))return true;
    if(!atom||atom==multiple||atom==incr||atom==save||std::find(effects.begin(),effects.end(),atom)!=effects.end())return false;
    return atom==targets||atom==timestamp||plain(atom)||((rule.flags&sakura::Files)&&!(rule.flags&sakura::Sensitive));
  }
};
constexpr std::array<const char*,17> names{"CLIPBOARD","TARGETS","TIMESTAMP","MULTIPLE","INCR","CLIPBOARD_MANAGER","SAVE_TARGETS",
  "UTF8_STRING","STRING","TEXT","text/plain","text/plain;charset=utf-8","text/plain;charset=UTF-8","ATOM_PAIR","DELETE","INSERT_SELECTION","INSERT_PROPERTY"};

/**
 * 中文：为指定物理连接/API 取得共享选择目标 atom 缓存，供复制粘贴校验。
 * English: Obtains the shared selection-target atom cache for this connection/API for copy/paste validation.
 */
Atoms atoms(void* connection,bool xcb);
using Clock=std::chrono::steady_clock;
enum class Stage { Collecting, Ready, Denied, Deleted, Exported };
struct Incremental {
  Stage stage=Stage::Collecting;
  Policy strict{};
  uint32_t type=0, hint=0;
  int format=0;
  size_t limit=0;
  bool notified=false;
  Clock::time_point deadline=Clock::now()+std::chrono::milliseconds(sakura::IncrementalTimeoutMs);
  std::vector<unsigned char> bytes;
  size_t reservation=0;bool slot=false;Counters* owner=nullptr;
  /**
   * 中文：释放流持有的缓冲预算及已占用的 INCR 槽位。
   * English: Releases byte budget and any INCR slot owned by the stream.
   * 参数 / Parameters: `~Incremental()`.
   */
  ~Incremental(){std::vector<unsigned char>().swap(bytes);if(reservation)owner->bufferBudget.fetch_sub(reservation);if(slot)owner->bufferSlots.fetch_sub(1);}
};
/**
 * 中文：清空私有缓冲并归还其容量预算，保留流的拒绝状态。
 * English: Clears a private buffer and returns its capacity budget while preserving the stream's denial state.
 * 参数 / Parameters: `releaseBuffer(Incremental& stream)`.
 */
void releaseBuffer(Incremental& stream){std::vector<unsigned char>().swap(stream.bytes);if(stream.reservation){stream.owner->bufferBudget.fetch_sub(stream.reservation);stream.reservation=0;}if(stream.slot){stream.owner->bufferSlots.fetch_sub(1);stream.slot=false;}}
/**
 * 中文：为增长后的真实 vector 容量计费，必要时预留流槽，分配或预算失败返回 false。
 * English: Charges actual vector capacity after growth and optionally reserves a stream slot, returning false for allocation or budget failure.
 * 参数 / Parameters: `reserveBuffer(Incremental& stream,size_t amount,bool slot=true)`.
 */
bool reserveBuffer(Incremental& stream,size_t amount,bool slot=true){
  if(!amount)return true;
  if(stream.reservation||(slot&&accounting().bufferSlots.load()>=sakura::IncrementalSlots)||!reserveBudget(amount))return false;
  try{stream.bytes.reserve(amount);}catch(...){accounting().bufferBudget.fetch_sub(amount);return false;}
  const auto actual=stream.bytes.capacity();
  if(actual>amount&&!reserveBudget(actual-amount)){std::vector<unsigned char>().swap(stream.bytes);accounting().bufferBudget.fetch_sub(amount);return false;}
  if(actual<amount)accounting().bufferBudget.fetch_sub(amount-actual);
  stream.owner=&accounting();stream.reservation=actual;stream.slot=slot;if(slot)accounting().bufferSlots.fetch_add(1);return true;
}
/**
 * 中文：为即将返回给应用的外部分配预留预算，防止缓冲复制绕过总量限制。
 * English: Reserves budget for an allocation returned to the application so copied buffers cannot bypass the process limit.
 * 参数 / Parameters: `reserveExternal(Incremental& stream,size_t amount)`.
 */
bool reserveExternal(Incremental& stream,size_t amount){if(stream.reservation||!reserveBudget(amount))return false;stream.owner=&accounting();stream.reservation=amount;return true;}
/**
 * 中文：尝试缩减已完整收集的缓冲容量，并按实际容量差归还预算。
 * English: Attempts to shrink a completed buffer and returns budget according to the actual capacity reduction.
 * 参数 / Parameters: `compactBuffer(Incremental& stream)`.
 */
bool compactBuffer(Incremental& stream){
  const auto size=stream.bytes.size();if(size>=stream.reservation)return true;
  if(size<=4096){std::array<unsigned char,4096> small{};if(size)std::memcpy(small.data(),stream.bytes.data(),size);const bool slot=stream.slot;releaseBuffer(stream);
    if(!reserveBuffer(stream,size,slot))return false;stream.bytes.resize(size);if(size)std::memcpy(stream.bytes.data(),small.data(),size);return true;}
  Incremental compact;if(!reserveBuffer(compact,size,false))return true;compact.bytes=stream.bytes;stream.bytes.swap(compact.bytes);std::swap(stream.reservation,compact.reservation);return true;
}
struct Group;
struct Transfer {
  bool copy=false,denied=false;
  uint32_t target=0,selection=0,time=0;
  std::shared_ptr<Incremental> incremental;
  uint64_t generation=0;std::weak_ptr<Group> group;bool control=false,completed=false;
};
using Key=std::tuple<void*,uint32_t,uint32_t>;

struct Reply {Key key;uint32_t offset,length,type;bool remove;std::shared_ptr<Transfer> transfer;};

struct Pair {uint32_t target,property;std::shared_ptr<Transfer> transfer;};
struct Group {
  void* connection;bool xcb,copy;uint32_t window,property,selection,time;
  Atoms names;Policy strict{};std::string endpoint;
  Clock::time_point deadline=Clock::now()+std::chrono::milliseconds(sakura::MultipleTimeoutMs);
  bool cancelled=false,complete=false;std::shared_ptr<Transfer> parent;std::vector<Pair> pairs;
  Incremental originalAllocation;
  std::vector<uint32_t> original;
};

struct Broker {std::thread worker;std::atomic<bool> done{false};int fd=-1,inputFd=-1,connected=0;bool interrupted=false;
  Clock::time_point deadline;std::weak_ptr<Group> group;};

// This state has an explicit lifetime. A child never destroys inherited mutex,
// CV or joinable thread objects whose owning threads disappeared at fork.
struct ProcessState {
  Counters counters;
  pid_t pid=getpid();
  std::recursive_mutex transportMutex;
  std::mutex mutex;
  std::map<std::pair<void*,bool>,Atoms> atomCache;
  std::map<xcb_connection_t*,std::pair<Display*,bool>> xlibConnections;
  std::map<Key,std::shared_ptr<Transfer>> transfers;
  std::map<std::pair<void*,uint64_t>,Reply> replies;
  size_t pendingReplies=0;
  std::condition_variable changed;
  uint64_t nextTransfer=0;
  std::map<Key,std::shared_ptr<Group>> groups;
  std::vector<std::shared_ptr<Broker>> brokers;
  std::thread brokerWatchdog;
  std::set<std::pair<void*,bool>> connections,inherited;
  std::set<std::pair<dev_t,ino_t>> inheritedSockets;
  ProcessState* abandoned=nullptr;
  std::atomic<bool> recover{false};
  unsigned forkDepth=0;
};
ProcessState* processState=nullptr;
/**
 * 中文：在新子状态第一次使用前回收隔离旧状态可安全释放的缓冲，保留未回收分配的预算。
 * English: Reclaims safely releasable quarantined buffers before first use of new child state while retaining budget for unreclaimed allocations.
 */
void recoverInherited(ProcessState& state);
/**
 * 中文：取得当前进程状态，检测未经 atfork 隔离的继承状态并拒绝使用。
 * English: Returns current-process state and refuses inherited state that did not pass atfork isolation.
 * 参数 / Parameters: `& process()`.
 */
ProcessState& process(){
  // _Fork/raw syscalls bypass atfork. Fail closed before touching inherited locks.
  if(!processState||processState->pid!=getpid())_exit(126);
  if(processState->recover)recoverInherited(*processState);
  return *processState;
}
/**
 * 中文：取得当前进程状态的原子预算，fork 后继续计入未回收的继承分配。
 * English: Returns atomic accounting in the current process state, retaining charges for unreclaimed inherited allocations after fork.
 * 参数 / Parameters: `& accounting()`.
 */
Counters& accounting(){return process().counters;}
/**
 * 中文：回收被隔离继承状态中可安全释放的缓冲，保留无法回收的在途分配账目。
 * English: Reclaims safely releasable buffers in quarantined inherited state while retaining charges for unrecoverable in-flight allocations.
 * 参数 / Parameters: `recoverInherited(ProcessState& state)`.
 */
void recoverInherited(ProcessState& state){
  std::lock_guard lock(state.mutex);if(!state.recover)return;
  auto old=state.abandoned;
  // Only frozen heap objects are inspected. A lost worker's transient allocation
  // may live on an invalidated stack; it remains charged to the same 32 MiB cap.
  for(auto& entry:old->transfers)if(auto stream=entry.second->incremental)releaseBuffer(*stream);
  /**
   * 中文：回收隔离组的父/子传输及原始列表缓冲，归还各分配预算并清空列表。
   * English: Reclaims quarantined group parent/child-transfer and original-list buffers, returning their allocation budgets and clearing the list.
   * 参数 / Parameters: `(const std::shared_ptr<Group>& group)`.
   */
  auto discard=[](const std::shared_ptr<Group>& group){
    if(group->parent&&group->parent->incremental)releaseBuffer(*group->parent->incremental);
    for(auto& pair:group->pairs)if(pair.transfer->incremental)releaseBuffer(*pair.transfer->incremental);
    releaseBuffer(group->originalAllocation);std::vector<uint32_t>().swap(group->original);
  };
  for(auto& entry:old->groups)discard(entry.second);
  for(auto& broker:old->brokers)if(auto group=broker->group.lock())discard(group);
  state.counters.bufferBudget.store(old->counters.bufferBudget.load());
  old->replies.clear();old->transfers.clear();old->groups.clear();old->atomCache.clear();old->xlibConnections.clear();old->connections.clear();old->inherited.clear();old->inheritedSockets.clear();
  if(status)__atomic_add_fetch(&status->loaded,1,__ATOMIC_RELAXED);
  state.recover=false;
}
/**
 * 中文：检查连接指针是否属于 fork 前隔离的身份集合。
 * English: Tests whether a connection pointer belongs to the quarantined pre-fork identity set.
 * 参数 / Parameters: `inherited(void* connection,bool xcb)`.
 */
bool inherited(void* connection,bool xcb){if(!configured)return false;auto& state=process();std::lock_guard lock(state.mutex);return state.inherited.count({connection,xcb})!=0;}
/**
 * 中文：要求连接身份属于当前进程；对隔离的继承连接立即拒绝。
 * English: Requires a connection identity valid in this process and immediately refuses quarantined inherited connections.
 * 参数 / Parameters: `fresh(void* connection,bool xcb)`.
 */
void fresh(void* connection,bool xcb){if(inherited(connection,xcb))_exit(126);}
/**
 * 中文：拒绝设备/inode 与继承连接相同的 socket，防止用旧 fd 重新包装绕过隔离。
 * English: Rejects sockets whose device/inode matches an inherited connection, preventing rewrapping an old fd to bypass isolation.
 * 参数 / Parameters: `freshSocket(int fd)`.
 */
void freshSocket(int fd){if(!configured)return;auto& state=process();struct stat identity{};
  std::lock_guard lock(state.mutex);if(fd>=0&&!fstat(fd,&identity)&&state.inheritedSockets.count({identity.st_dev,identity.st_ino}))_exit(126);}
/**
 * 中文：记录新连接身份与 socket 指纹，并限制当前及继承身份的累计数量。
 * English: Registers a new connection and socket fingerprint while bounding the combined current/inherited identity count.
 * 参数 / Parameters: `registerConnection(void* connection,bool xcb)`.
 */
bool registerConnection(void* connection,bool xcb){
  if(!configured||!connection)return true;auto& state=process();std::lock_guard lock(state.mutex);
  const int fd=xcb?xcb_get_file_descriptor(static_cast<xcb_connection_t*>(connection)):ConnectionNumber(static_cast<Display*>(connection));
  struct stat identity{};if(fd>=0&&!fstat(fd,&identity)&&state.inheritedSockets.count({identity.st_dev,identity.st_ino}))return false;
  if(state.connections.count({connection,xcb}))return true;
  if(state.connections.size()+state.inherited.size()>=sakura::ConnectionIdentities)return false;
  state.connections.insert({connection,xcb});return true;
}
struct ForkFd {int fd=-1;dev_t device=0;ino_t inode=0;};
ProcessState* forkSource=nullptr;
ProcessState* forkCandidate=nullptr;
std::array<ForkFd,sakura::MultipleGroups*2> forkDescriptors{};
size_t forkDescriptorCount=0;
/**
 * 中文：在父进程预先分配子状态并冻结相关锁，保证子进程不操作继承的在途线程对象。
 * English: Preallocates child state in the parent and freezes related locks so the child need not operate inherited in-flight thread objects.
 * 参数 / Parameters: `prepareFork()`.
 */
void prepareFork(){
  auto& source=process();source.transportMutex.lock();source.mutex.lock();
  forkSource=&source;forkCandidate=nullptr;forkDescriptorCount=0;
  try{
    // Preparation and allocation happen in the parent, before glibc freezes its
    // allocator. There is no child-side mutex repair or C++ object construction.
    if(source.forkDepth>=sakura::ForkDepth)return;
    auto candidate=std::make_unique<ProcessState>();candidate->forkDepth=source.forkDepth+1;
    candidate->inherited=source.inherited;candidate->inherited.insert(source.connections.begin(),source.connections.end());
    candidate->inheritedSockets=source.inheritedSockets;
    for(const auto& entry:source.connections){const int fd=entry.second?xcb_get_file_descriptor(static_cast<xcb_connection_t*>(entry.first)):ConnectionNumber(static_cast<Display*>(entry.first));
      struct stat identity{};if(fd>=0&&!fstat(fd,&identity))candidate->inheritedSockets.insert({identity.st_dev,identity.st_ino});}
    candidate->nextTransfer=source.nextTransfer;candidate->abandoned=&source;candidate->recover=true;
    for(auto& broker:source.brokers){
      struct stat identity{};if(broker->fd<0||fstat(broker->fd,&identity))continue;
      for(int fd:{broker->fd,broker->inputFd}){
        struct stat actual{};if(fd>=0&&!fstat(fd,&actual)&&actual.st_dev==identity.st_dev&&actual.st_ino==identity.st_ino&&forkDescriptorCount<forkDescriptors.size())
          forkDescriptors[forkDescriptorCount++]={fd,actual.st_dev,actual.st_ino};
      }
    }
    forkCandidate=candidate.release();
  }catch(...){forkCandidate=nullptr;}
}
/**
 * 中文：在父进程恢复锁并撤销对子状态的临时准备所有权。
 * English: Restores parent locks and releases temporary ownership of prepared child state.
 * 参数 / Parameters: `parentFork()`.
 */
void parentFork(){
  auto candidate=forkCandidate;forkCandidate=nullptr;
  forkSource->mutex.unlock();forkSource->transportMutex.unlock();
  delete candidate;
}
// fork 子进程仅关闭自己固定的描述符引用；隔离旧状态，不能碰父进程仍使用的锁和连接。
/**
 * 中文：切换为预分配的新状态，隔离旧连接、锁和线程并关闭子进程独有的 broker fd。
 * English: Switches to preallocated state, quarantines old connections/locks/threads and closes the child's broker-fd copies.
 * 参数 / Parameters: `childFork()`.
 * 设计 / Design: 只 close 继承描述符而不 shutdown，避免破坏父进程共享 socket；旧线程与条件变量不在子进程析构。
 * Only closes inherited descriptor copies, never shutting down the parent's shared socket; old threads and condition variables are not destroyed in the child.
 */
void childFork(){
  const int saved=errno;
  // close() drops only this process's descriptor reference. shutdown() or
  // xcb_disconnect() here would corrupt the parent's still-live X11 transport.
  for(size_t i=0;i<forkDescriptorCount;++i){const auto& fd=forkDescriptors[i];struct stat actual{};
    if(!fstat(fd.fd,&actual)&&actual.st_dev==fd.device&&actual.st_ino==fd.inode)close(fd.fd);}
  processState=forkCandidate;
  if(processState)processState->pid=getpid();
  forkCandidate=nullptr;forkSource=nullptr;forkDescriptorCount=0;errno=saved;
  // The inherited state stays quarantined. No inherited lock is unlocked and
  // no inherited thread/CV is destroyed, even at normal C++ process exit.
}
/**
 * 中文：按连接和 API 缓存选择、文本、元数据和副作用目标 atom。
 * English: Caches selection, text, metadata and side-effect target atoms per connection and API.
 * 参数 / Parameters: `atoms(void* connection,bool xcb)`.
 */
Atoms atoms(void* connection,bool xcb) {
  {std::lock_guard lock(process().mutex);auto found=process().atomCache.find({connection,xcb});if(found!=process().atomCache.end())return found->second;}
  std::array<uint32_t,17> values{};
  for(size_t i=0;i<names.size();++i) {
    if(xcb) {
      CACHED_REAL(intern,xcb_intern_atom);
      CACHED_REAL(reply,xcb_intern_atom_reply);
      auto result=reply(static_cast<xcb_connection_t*>(connection),intern(static_cast<xcb_connection_t*>(connection),0,std::strlen(names[i]),names[i]),nullptr);
      if(result){values[i]=result->atom;free(result);}
    } else {
      CACHED_REAL(intern,XInternAtom);
      values[i]=intern(static_cast<Display*>(connection),names[i],False);
    }
  }
  Atoms value{values[0],values[1],values[2],values[3],values[4],values[5],values[6],{},values[13],{values[14],values[15],values[16]}};
  std::copy(values.begin()+7,values.begin()+13,value.text.begin());
  {std::lock_guard lock(process().mutex);process().atomCache[{connection,xcb}]=value;}
  return value;
}
/**
 * 中文：监测私有 broker 连接和传输截止时间，关闭超时 socket 以中断阻塞的认证或请求。
 * English: Watches private broker setup and transfer deadlines, shutting down timed-out sockets to interrupt blocked authentication or requests.
 * 参数 / Parameters: `watchBrokers()`.
 */
void watchBrokers(){while(!accounting().shuttingDown.load()){
    {std::lock_guard lock(process().mutex);for(auto& broker:process().brokers){auto group=broker->group.lock();if(broker->fd>=0&&!broker->interrupted&&
        (Clock::now()>=broker->deadline||(group&&group->cancelled))){broker->interrupted=true;shutdown(broker->fd,SHUT_RDWR);}}}
    usleep(20000);
  }}
/**
 * 中文：移出并 join 已完成的私有 broker 工作线程。
 * English: Removes and joins completed private broker workers.
 * 参数 / Parameters: `reapBrokers()`.
 */
void reapBrokers(){std::vector<std::shared_ptr<Broker>> finished;{std::lock_guard lock(process().mutex);for(auto it=process().brokers.begin();it!=process().brokers.end();)if((*it)->done.load()){finished.push_back(*it);it=process().brokers.erase(it);}else ++it;}
  for(auto& item:finished)if(item->worker.joinable())item->worker.join();}
/**
 * 中文：标记所有组取消、唤醒等待者并中断/回收 broker 线程和连接。
 * English: Cancels groups, wakes waiters and interrupts/reaps broker workers and connections.
 * 参数 / Parameters: `shutdownBrokers()`.
 */
void shutdownBrokers(){accounting().shuttingDown.store(true);std::vector<std::shared_ptr<Broker>> running;
  {std::lock_guard lock(process().mutex);for(auto& entry:process().groups)entry.second->cancelled=true;running=process().brokers;for(auto& item:running)if(item->fd>=0)shutdown(item->fd,SHUT_RDWR);}
  for(auto& item:running)if(item->worker.joinable())item->worker.join();
  if(process().brokerWatchdog.joinable())process().brokerWatchdog.join();}
/**
 * 中文：按连接别名及可选窗口取消组/传输、清理回复与缓存，关闭连接时也移除身份映射。
 * English: Cancels groups/transfers by connection alias and optional window, clearing replies/caches and removing identity mappings on connection closure.
 */
void forget(void* connection,uint32_t window=0);
/**
 * 中文：收紧组及全部子传输策略，拒绝已不允许的内容并更新失败属性对。
 * English: Tightens group/child policies, denies newly disallowed content and updates failed property pairs.
 */
void refreshGroup(const std::shared_ptr<Group>& group,const Policy& rule);
// Xlib and XCB can share one connection and mix property APIs. Keep both keys
// tied to the same transfer rather than letting a toolkit switch bypass it.
/**
 * 中文：取得同一物理连接的 Xlib/XCB 别名，使两套 API 共享策略状态。
 * English: Finds the Xlib/XCB alias of one physical connection so both APIs share policy state.
 * 参数 / Parameters: `* peer(void* connection)`.
 */
void* peer(void* connection) {
  auto found=process().xlibConnections.find(static_cast<xcb_connection_t*>(connection));
  if(found!=process().xlibConnections.end())return found->second.first;
  for(const auto& item:process().xlibConnections)if(item.second.first==connection)return item.first;
  return nullptr;
}
/**
 * 中文：撤销组及其属性关联，取消并拒绝相关传输，释放私有内容。
 * English: Retires a group and its property associations, cancelling and denying related transfers and releasing private content.
 * 参数 / Parameters: `retireGroup(const std::shared_ptr<Group>& group)`.
 */
/**
 * 中文：撤销组及其属性关联，取消并拒绝相关传输，释放私有内容。
 * English: Retires a group and its property associations, cancelling and denying related transfers and releasing private content.
 */
void retireGroup(const std::shared_ptr<Group>& group){
  group->cancelled=true;
  /**
   * 中文：退役原组成员传输：标为拒绝，将已有流置为 Deleted 并回收其缓冲预算。
   * English: Retires an original group-member transfer by marking it denied, setting any stream to Deleted and returning its buffer budget.
   * 参数 / Parameters: `(const std::shared_ptr<Transfer>& transfer)`.
   */
  auto discard=[](const std::shared_ptr<Transfer>& transfer){transfer->denied=true;if(auto stream=transfer->incremental){stream->stage=Stage::Deleted;releaseBuffer(*stream);}};
  discard(group->parent);for(auto& pair:group->pairs)discard(pair.transfer);
  for(auto it=process().transfers.begin();it!=process().transfers.end();)if(it->second==group->parent||it->second->group.lock()==group)it=process().transfers.erase(it);else ++it;
  for(auto it=process().groups.begin();it!=process().groups.end();)if(it->second==group)it=process().groups.erase(it);else ++it;
  process().changed.notify_all();
}
/**
 * 中文：判断传输是否仍由未完成组或正在收集的 INCR 流占用。
 * English: Tests whether an unfinished group or collecting INCR stream still occupies a transfer.
 * 参数 / Parameters: `busy(const std::shared_ptr<Transfer>& transfer)`.
 */
bool busy(const std::shared_ptr<Transfer>& transfer){
  if(auto group=transfer->group.lock())return !group->complete;
  if(auto stream=transfer->incremental)return stream->stage==Stage::Collecting||(stream->stage==Stage::Ready&&!transfer->completed);
  return !transfer->completed&&!transfer->denied;
}
/**
 * 中文：按请求标识记录完成通知并结束对应传输的在途状态。
 * English: Matches request identity to record a completion notification and finish the matching in-flight transfer state.
 * 参数 / Parameters: `finished(void* connection,uint32_t window,uint32_t property,uint32_t selection,uint32_t target,uint32_t time,bool copy)`.
 */
void finished(void* connection,uint32_t window,uint32_t property,uint32_t selection,uint32_t target,uint32_t time,bool copy){
  std::lock_guard lock(process().mutex);
  for(auto& entry:process().transfers)if(std::get<0>(entry.first)==connection&&std::get<1>(entry.first)==window&&(!property||std::get<2>(entry.first)==property)){
    auto transfer=entry.second;if(transfer->copy==copy&&transfer->selection==selection&&transfer->target==target&&transfer->time==time)transfer->completed=true;
  }
}
/**
 * 中文：为属性登记一代新传输，拒绝忙碌键和容量超限，并关联物理连接的两套 API 别名。
 * English: Registers a new transfer generation for a property, refusing busy keys/capacity overflow and linking both physical-connection API aliases.
 * 参数 / Parameters: `remember(void* connection,uint32_t window,uint32_t property,Transfer value)`.
 */
bool remember(void* connection,uint32_t window,uint32_t property,Transfer value) {
  std::lock_guard lock(process().mutex);
  const Key key{connection,window,property};
  auto previous=process().transfers.find(key);if(previous!=process().transfers.end())if(auto group=previous->second->group.lock()){
    if(!group->complete)return false;retireGroup(group);
  }
  const auto other=peer(connection);const Key alias{other,window,property};
  const size_t additional=(!process().transfers.count(key)?1:0)+(other&&!process().transfers.count(alias)?1:0);
  if(process().transfers.size()+additional>2048)return false;
  auto entry=std::make_shared<Transfer>(std::move(value));
  entry->generation=++process().nextTransfer;
  process().transfers[key]=entry;if(other)process().transfers[alias]=entry;return true;
}
/**
 * 中文：返回属性当前传输的共享身份，供等待后校验是否已被重用。
 * English: Returns the property's current shared transfer identity for post-wait reuse checks.
 * 参数 / Parameters: `reference(void* connection,uint32_t window,uint32_t property)`.
 */
std::shared_ptr<Transfer> reference(void* connection,uint32_t window,uint32_t property){std::lock_guard lock(process().mutex);auto found=process().transfers.find({connection,window,property});return found==process().transfers.end()?nullptr:found->second;}
/**
 * 中文：在锁内复制属性对应的传输快照，找不到返回 false。
 * English: Copies a property's transfer snapshot under lock, returning false when absent.
 * 参数 / Parameters: `lookup(void* connection,uint32_t window,uint32_t property,Transfer& value)`.
 */
bool lookup(void* connection,uint32_t window,uint32_t property,Transfer& value) {
  std::lock_guard lock(process().mutex);
  auto found=process().transfers.find({connection,window,property});
  if(found==process().transfers.end())return false;
  value=*found->second;return true;
}
/**
 * 中文：将属性传输标为拒绝并清空其私有数据。
 * English: Marks a property transfer denied and clears its private data.
 * 参数 / Parameters: `deny(void* connection,uint32_t window,uint32_t property)`.
 */
void deny(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(process().mutex);
  auto found=process().transfers.find({connection,window,property});
  if(found!=process().transfers.end()){
    found->second->denied=true;
    if(auto stream=found->second->incremental){stream->stage=Stage::Denied;releaseBuffer(*stream);process().changed.notify_all();}
  }
}
/**
 * 中文：拒绝当前 INCR 流、释放缓冲并唤醒等待完整内容的读取者。
 * English: Denies an INCR stream, releases its buffer and wakes readers waiting for complete content.
 * 参数 / Parameters: `denyIncremental(void* connection,uint32_t window,uint32_t property)`.
 */
void denyIncremental(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(process().mutex);auto found=process().transfers.find({connection,window,property});if(found==process().transfers.end())return;
  found->second->denied=true;
  if(!found->second->incremental)found->second->incremental=std::make_shared<Incremental>();
  auto stream=found->second->incremental;stream->stage=Stage::Denied;releaseBuffer(*stream);process().changed.notify_all();
}
/**
 * 中文：检查字节上限、文本编码和敏感内容限制，决定是否可暴露完整内容。
 * English: Checks byte limits, text encoding and sensitive-content restrictions before exposing complete content.
 * 参数 / Parameters: `checkContent(const Atoms& names,uint32_t target,uint32_t type,int format,const void* bytes,size_t count,const Policy& rule)`.
 */
bool checkContent(const Atoms& names,uint32_t target,uint32_t type,int format,const void* bytes,size_t count,const Policy& rule) {
  if(!active(rule))return true;
  if(!names.allowed(target,rule)||type==names.incr)return false;
  if(target==names.targets)return type==XA_ATOM&&format==32&&count<=4096;
  if(target==names.timestamp)return type==XA_INTEGER&&format==32&&count==1;
  if(!names.allowed(type,rule))return false;
  if(names.plain(target)||names.plain(type)) {
    if(format!=8||(!bytes&&count)||count>rule.maximum)return false;
    const auto first=static_cast<const unsigned char*>(bytes);
    Incremental converted;
    if(type==XA_STRING) {
      size_t size=count;for(size_t i=0;i<count;++i)if(first[i]>=128)++size;
      if(size>rule.maximum)return false;
      if(!(rule.flags&sakura::Sensitive))return true;
      if(!reserveBuffer(converted,size,false))return false;
      for(size_t i=0;i<count;++i){unsigned c=first[i];if(c<128)converted.bytes.push_back(c);else{converted.bytes.push_back(0xc0|(c>>6));converted.bytes.push_back(0x80|(c&63));}}
      return !sensitive(std::string_view(converted.bytes.empty()?"":reinterpret_cast<const char*>(converted.bytes.data()),converted.bytes.size()));
    } else {
      if(!utf8(first,count))return false;
      return !(rule.flags&sakura::Sensitive)||!sensitive(std::string_view(bytes?static_cast<const char*>(bytes):"",count));
    }
  }
  return format>0&&(format==8||format==16||format==32)&&count<=size_t(16*1024*1024)/(format/8);
}
/**
 * 中文：核对目标与属性类型/格式相容，并按文本、文件和元数据规则检查完整载荷。
 * English: Checks target/property type and format compatibility and validates complete payloads under text, file and metadata rules.
 * 参数 / Parameters: `content(const Atoms& names,uint32_t target,uint32_t type,int format,const void* bytes,size_t count,const Policy& rule)`.
 */
bool content(const Atoms& names,uint32_t target,uint32_t type,int format,const void* bytes,size_t count,const Policy& rule) {
  try {return checkContent(names,target,type,format,bytes,count,rule);}catch(...){return false;}
}
/**
 * 中文：判断零长度属性查询的类型和总量元数据是否安全，避免误将部分内容当完整内容。
 * English: Checks whether type/size metadata from a zero-length query is safe, avoiding acceptance of partial payloads as complete content.
 * 参数 / Parameters: `metadataOnly(const Atoms& names,uint32_t target,uint32_t type,int format,size_t count,size_t after,const Policy& rule)`.
 */
bool metadataOnly(const Atoms& names,uint32_t target,uint32_t type,int format,size_t count,size_t after,const Policy& rule) {
  if(count||!after||!names.allowed(target,rule))return false;
  if(target==names.targets)return type==XA_ATOM&&format==32&&after<=4096*4;
  if(names.plain(target))return names.plain(type)&&format==8&&after<=rule.maximum;
  return names.allowed(type,rule)&&!(rule.flags&sakura::Sensitive)&&format>0&&after<=16*1024*1024;
}
/**
 * 中文：就地保留允许的 TARGETS atom 并返回压缩后的元素数。
 * English: Compacts permitted TARGETS atoms in place and returns the retained element count.
 * 参数 / Parameters: `filter(const Atoms& names,AtomType* data,size_t length,const Policy& rule)`.
 */
template<class AtomType> size_t filter(const Atoms& names,AtomType* data,size_t length,const Policy& rule) {
  size_t output=0;
  for(size_t i=0;i<length;++i)if(names.allowed(data[i],rule)||data[i]==names.multiple)data[output++]=data[i];
  return output;
}
// A Display and its XCB peer always share the same buffer and state. No X11
// call is made while this mutex is held: Qt also reads events on another thread.
/**
 * 中文：对方向/文件权限取交集、敏感检查取并集、长度上限取最小值。
 * English: Intersects direction/file permissions, unions sensitive checks and takes the minimum length limit.
 * 参数 / Parameters: `tighten(Policy& accumulated,const Policy& rule)`.
 * 设计 / Design: 在途流只允许变严；规则中途关闭也不能解除已捕获的限制。
 * An in-flight stream can only become stricter; disabling a rule mid-stream cannot remove captured restrictions.
 */
void tighten(Policy& accumulated,const Policy& rule) {
  if(!active(rule))return;
  if(!active(accumulated)){accumulated=rule;return;}
  accumulated.flags=sakura::Active|((accumulated.flags&rule.flags)&(sakura::Copy|sakura::Paste|sakura::Files))|
    ((accumulated.flags|rule.flags)&sakura::Sensitive);
  accumulated.maximum=std::min(accumulated.maximum,rule.maximum);
}
/**
 * 中文：计算当前目标可收集的最大字节数，并始终保留进程 INCR 硬上限。
 * English: Computes the target's collection limit while always retaining the hard process INCR limit.
 * 参数 / Parameters: `incrementalLimit(const Atoms& names,uint32_t target,const Policy& rule)`.
 */
size_t incrementalLimit(const Atoms& names,uint32_t target,const Policy& rule) {
  if(!active(rule))return sakura::IncrementalMaximum;
  if(!names.allowed(target,rule))return 0;
  if(target==names.targets)return 4096*4;
  if(target==names.timestamp)return 4;
  return names.plain(target)?rule.maximum:sakura::IncrementalMaximum;
}
/**
 * 中文：核对属性世代未变后创建或复用私有 INCR 状态，拒绝已拒绝身份、超限提示和预算不足。
 * English: Creates or reuses private INCR state after checking property generation, refusing denied identities, excessive hints or insufficient budget.
 * 参数 / Parameters: `begin(void* connection,uint32_t window,uint32_t property,const Atoms& names, const Transfer& transfer,uint32_t hint,bool* created=nullptr)`.
 */
std::shared_ptr<Incremental> begin(void* connection,uint32_t window,uint32_t property,const Atoms& names,
  const Transfer& transfer,uint32_t hint,bool* created=nullptr) {
  if(created)*created=false;
  std::lock_guard lock(process().mutex);
  auto found=process().transfers.find({connection,window,property});
  if(found==process().transfers.end()||found->second->denied||found->second->generation!=transfer.generation)return {};
  if(found->second->incremental)return found->second->incremental;
  auto stream=std::make_shared<Incremental>();stream->strict=current();stream->hint=hint;
  stream->limit=incrementalLimit(names,transfer.target,stream->strict);
  if(!direction(transfer.copy,stream->strict)||!stream->limit||hint>stream->limit||!reserveBuffer(*stream,stream->limit))return {};
  found->second->incremental=stream;if(created)*created=true;return stream;
}
/**
 * 中文：将流转换为 Denied、释放字节预算并唤醒等待者。
 * English: Transitions a stream to Denied, releases byte budget and wakes waiters.
 * 参数 / Parameters: `reject(const std::shared_ptr<Incremental>& stream)`.
 */
bool reject(const std::shared_ptr<Incremental>& stream) {
  std::lock_guard lock(process().mutex);
  if(stream->stage==Stage::Denied||stream->stage==Stage::Deleted)return false;
  stream->stage=Stage::Denied;releaseBuffer(*stream);process().changed.notify_all();return true;
}
/**
 * 中文：收紧流策略并返回收集状态、期限、方向、提示及当前长度是否仍允许；调用方据此执行拒绝。
 * English: Tightens stream policy and reports whether collection state, deadline, direction, hint and size remain permitted; the caller performs refusal.
 * 参数 / Parameters: `update(const std::shared_ptr<Incremental>& stream,const Atoms& names,uint32_t target,bool copy)`.
 */
bool update(const std::shared_ptr<Incremental>& stream,const Atoms& names,uint32_t target,bool copy) {
  std::lock_guard lock(process().mutex);tighten(stream->strict,current());
  return stream->stage==Stage::Collecting&&Clock::now()<stream->deadline&&direction(copy,stream->strict)&&
    stream->hint<=incrementalLimit(names,target,stream->strict)&&stream->bytes.size()<=incrementalLimit(names,target,stream->strict);
}
/**
 * 中文：验证并追加一个 INCR 分块，终止块到达后检查完整内容才转为 Ready。
 * English: Validates and appends one INCR chunk, transitioning to Ready only after termination and complete-content validation.
 * 参数 / Parameters: `append(const std::shared_ptr<Incremental>& stream,const Atoms& names,uint32_t target,uint32_t type,int format, const void* data,size_t count,bool nativeLong,bool copy)`.
 * 设计 / Design: 收集阶段不发布前缀；类型/格式、期限、提示与字节预算任何异常都清空并保持拒绝。
 * No prefix is published while collecting; type/format, deadline, hint or byte-budget errors clear content and retain denial.
 */
bool append(const std::shared_ptr<Incremental>& stream,const Atoms& names,uint32_t target,uint32_t type,int format,
  const void* data,size_t count,bool nativeLong,bool copy) {
  std::lock_guard lock(process().mutex);tighten(stream->strict,current());
  if(stream->stage!=Stage::Collecting||Clock::now()>=stream->deadline||!direction(copy,stream->strict))return false;
  if(!type||type==names.incr||(format!=8&&format!=16&&format!=32)||(!data&&count)||
    (stream->type&&(stream->type!=type||stream->format!=format)))return false;
  const size_t unit=format/8,limit=std::min(stream->limit,incrementalLimit(names,target,stream->strict));
  if(count>limit/unit||stream->bytes.size()>limit-count*unit)return false;
  if(!stream->type){stream->type=type;stream->format=format;}
  const size_t previous=stream->bytes.size();stream->bytes.resize(previous+count*unit);
  if(format==32&&nativeLong){const auto values=static_cast<const unsigned long*>(data);
    for(size_t i=0;i<count;++i){const uint32_t value=values[i];std::memcpy(stream->bytes.data()+previous+i*4,&value,4);}}
  else if(count)std::memcpy(stream->bytes.data()+previous,data,count*unit);
  if(count)return true;
  if(stream->bytes.size()<stream->hint||!content(names,target,stream->type,stream->format,stream->bytes.data(),stream->bytes.size()/unit,stream->strict))return false;
  if(!compactBuffer(*stream))return false;stream->stage=Stage::Ready;process().changed.notify_all();return true;
}
struct Property {
  uint32_t type=0;int format=0;size_t count=0,after=0;unsigned char* bytes=nullptr;bool nativeLong=false,ok=false;
  /**
   * 中文：释放 readProperty 得到的 XCB 回复内存。
   * English: Frees the XCB reply owned by readProperty's result.
   * 参数 / Parameters: `~Property()`.
   */
  ~Property(){if(bytes){if(nativeLong){CACHED_REAL(release,XFree);release(bytes);}else free(bytes);}}
};
/**
 * 中文：从私有连接完整读取属性并包装回复所有权，供控制元数据和分块检查。
 * English: Reads a property through the private connection and wraps reply ownership for control-metadata and chunk checks.
 * 参数 / Parameters: `readProperty(void* connection,bool xcb,uint32_t window,uint32_t property,size_t limit,Property& value)`.
 */
void readProperty(void* connection,bool xcb,uint32_t window,uint32_t property,size_t limit,Property& value) {
  if(xcb){
    CACHED_REAL(get,xcb_get_property);
    CACHED_REAL(reply,xcb_get_property_reply);
    auto raw=reply(static_cast<xcb_connection_t*>(connection),get(static_cast<xcb_connection_t*>(connection),0,window,property,XCB_GET_PROPERTY_TYPE_ANY,0,(limit+3)/4),nullptr);
    if(!raw)return;
    value.ok=true;value.type=raw->type;value.format=raw->format;value.count=raw->value_len;value.after=raw->bytes_after;
    const size_t size=(value.format==8||value.format==16||value.format==32)?value.count*(value.format/8):0;
    if(size>size_t(raw->length)*4){value.ok=false;free(raw);return;}
    // Keep the allocation rather than copying an untrusted property's payload.
    value.bytes=reinterpret_cast<unsigned char*>(raw);std::memmove(raw,raw+1,size);
  }else{
    CACHED_REAL(get,XGetWindowProperty);
    Atom type=0;unsigned long count=0,after=0;value.nativeLong=true;
    value.ok=get(static_cast<Display*>(connection),window,property,0,(limit+3)/4,False,AnyPropertyType,
      &type,&value.format,&count,&after,&value.bytes)==Success;
    value.type=type;value.count=count;value.after=after;
  }
}
/**
 * 中文：在未启用主动限制的 MULTIPLE 请求中清理已完成的旧组状态。
 * English: Clears completed prior group state when processing MULTIPLE without active enforcement.
 * 参数 / Parameters: `reuseMultiple(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names)`.
 */
void reuseMultiple(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names){
  Property list;readProperty(connection,xcb,window,property,sakura::MultiplePairs*8,list);
  if(!list.ok||list.after||(list.type!=names.pair&&list.type!=XA_ATOM)||list.format!=32||list.count%2||list.count>sakura::MultiplePairs*2)return;
  std::lock_guard lock(process().mutex);
  for(size_t i=1;i<list.count;i+=2){uint32_t atom=0;if(list.nativeLong)atom=reinterpret_cast<unsigned long*>(list.bytes)[i];else std::memcpy(&atom,list.bytes+i*4,4);
    auto previous=process().transfers.find({connection,window,atom});if(previous!=process().transfers.end())if(auto group=previous->second->group.lock();group&&group->complete)retireGroup(group);
  }
}
/**
 * 中文：通过真实 Xlib/XCB API 删除属性，避免递归进入注入钩子。
 * English: Deletes a property through the real Xlib/XCB API, avoiding recursive interception.
 * 参数 / Parameters: `deleteProperty(void* connection,bool xcb,uint32_t window,uint32_t property)`.
 */
void deleteProperty(void* connection,bool xcb,uint32_t window,uint32_t property) {
  if(xcb){CACHED_REAL(remove,xcb_delete_property);remove(static_cast<xcb_connection_t*>(connection),window,property);xcb_flush(static_cast<xcb_connection_t*>(connection));}
  else{CACHED_REAL(remove,XDeleteProperty);remove(static_cast<Display*>(connection),window,property);XFlush(static_cast<Display*>(connection));}
}
/**
 * 中文：先写入空属性再真实删除，生成 owner 可识别的 PropertyDelete 确认，而不发布载荷。
 * English: Writes an empty property then really deletes it, generating an owner-recognizable PropertyDelete acknowledgement without publishing payload.
 * 参数 / Parameters: `acknowledge(void* connection,bool xcb,uint32_t window,uint32_t property)`.
 */
void acknowledge(void* connection,bool xcb,uint32_t window,uint32_t property) {
  // Actual empty property deletion generates a server PropertyDelete event.
  // Synthetic PropertyNotify is ignored by some owners; no payload is exported.
  if(xcb){CACHED_REAL(write,xcb_change_property);
    write(static_cast<xcb_connection_t*>(connection),XCB_PROP_MODE_REPLACE,window,property,XCB_ATOM_INTEGER,8,0,nullptr);}
  else{CACHED_REAL(write,XChangeProperty);
    write(static_cast<Display*>(connection),window,property,XA_INTEGER,8,PropModeReplace,nullptr,0);}
  deleteProperty(connection,xcb,window,property);
}
/**
 * 中文：发送指定成功/失败的 SelectionNotify 并刷新私有连接。
 * English: Sends a success/failure SelectionNotify and flushes the private connection.
 * 参数 / Parameters: `sendResult(void* connection,bool xcb,uint32_t window,uint32_t property,const Transfer& transfer,bool allowed)`.
 */
void sendResult(void* connection,bool xcb,uint32_t window,uint32_t property,const Transfer& transfer,bool allowed) {
  if(xcb){CACHED_REAL(send,xcb_send_event);
    xcb_selection_notify_event_t event{};event.response_type=XCB_SELECTION_NOTIFY;event.requestor=window;
    event.selection=transfer.selection;event.target=transfer.target;event.time=transfer.time;event.property=allowed?property:0;
    std::array<char,32> bytes{};std::memcpy(bytes.data(),&event,sizeof(event));send(static_cast<xcb_connection_t*>(connection),0,window,0,bytes.data());xcb_flush(static_cast<xcb_connection_t*>(connection));
  }else{CACHED_REAL(send,XSendEvent);auto display=static_cast<Display*>(connection);
    XEvent event{};event.xselection={SelectionNotify,0,True,display,window,transfer.selection,transfer.target,allowed?property:None,transfer.time};
    send(display,window,False,0,&event);XFlush(display);}
}
/**
 * 中文：从私有完整缓冲发布一次完整属性，拒绝无法在单次请求中完整承载的内容。
 * English: Publishes a complete private buffer in one property request, refusing payloads too large for one complete request.
 * 参数 / Parameters: `publish(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,const Transfer& transfer)`.
 * 设计 / Design: 发布前在锁内取快照，实际 X 请求在解锁后执行；不以重新 INCR 分块的方式暴露未经整体验证的前缀。
 * Takes a snapshot under lock, sends the X request after unlocking and does not replay INCR chunks that could expose a prefix.
 */
bool publish(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,const Transfer& transfer) {
  auto stream=transfer.incremental;auto wire=xcb?static_cast<xcb_connection_t*>(connection):XGetXCBConnection(static_cast<Display*>(connection));
  if(!xcb)XFlush(static_cast<Display*>(connection));
  CACHED_REAL(maximum,xcb_get_maximum_request_length);
  CACHED_REAL(write,xcb_change_property_checked);
  CACHED_REAL(check,xcb_request_check);
  const auto requestMaximum=maximum(wire);
  // Publish one complete property. If BigRequests cannot hold it, refuse it;
  // a replay of INCR could expose a prefix when rules tighten during delivery.
  std::unique_lock lock(process().mutex);tighten(stream->strict,current());
  if(stream->stage!=Stage::Ready||!direction(true,stream->strict)||
    !content(names,transfer.target,stream->type,stream->format,stream->bytes.data(),stream->bytes.size()/(stream->format/8),stream->strict)||
    (stream->bytes.size()+3)/4+7>requestMaximum)return false;
  if(transfer.target==names.targets&&active(stream->strict)) {
    auto values=reinterpret_cast<uint32_t*>(stream->bytes.data());const auto count=filter(names,values,stream->bytes.size()/4,stream->strict);stream->bytes.resize(count*4);
  }
  const auto type=stream->type;const auto format=stream->format;const auto count=stream->bytes.size()/(format/8);
  // Keep a bounded private snapshot while the checked XCB request runs. Xlib's
  // shared-connection locking callbacks must never reenter our state mutex.
  Incremental payload;if(!reserveBuffer(payload,stream->bytes.size(),false))return false;payload.bytes=stream->bytes;
  lock.unlock();const auto cookie=write(wire,XCB_PROP_MODE_REPLACE,window,property,type,format,count,payload.bytes.data());auto error=check(wire,cookie);
  const bool allowed=!error;free(error);return allowed;
}
/**
 * 中文：截获复制方向的 INCR 头及后续分块，完整验证后发布并补发先前延迟的通知。
 * English: Intercepts copy-direction INCR headers/chunks, then publishes validated complete content and releases the held notification.
 * 参数 / Parameters: `capture(void* connection,bool xcb,uint32_t window,uint32_t property,uint32_t type,int format,int mode,const void* data, size_t count,bool nativeLong,const Atoms& names,Transfer transfer)`.
 */
bool capture(void* connection,bool xcb,uint32_t window,uint32_t property,uint32_t type,int format,int mode,const void* data,
  size_t count,bool nativeLong,const Atoms& names,Transfer transfer) {
  if(type!=names.incr&&!transfer.incremental)return false;
  auto stream=transfer.incremental;
  if(!stream){
    const bool valid=mode==PropModeReplace&&format==32&&count==1&&data;
    uint32_t hint=0;if(valid){if(nativeLong)hint=*static_cast<const unsigned long*>(data);else std::memcpy(&hint,data,4);}
    if(valid)stream=begin(connection,window,property,names,transfer,hint);
    if(!stream){blocked(true);denyIncremental(connection,window,property);return true;}
    // The first deletion waits until the application has selected property
    // events and sent its SelectionNotify, which our send hooks hold privately.
    return true;
  }
  bool notified=false;{std::lock_guard lock(process().mutex);notified=stream->notified;}
  if(!notified||!update(stream,names,transfer.target,true)||(mode!=PropModeReplace&&mode!=PropModeAppend)||
    !append(stream,names,transfer.target,type,format,data,count,nativeLong,true)) {
    if(reject(stream)){blocked(true);if(notified)sendResult(connection,xcb,window,property,transfer,false);}
    deny(connection,window,property);return true;
  }
  Stage stage;{std::lock_guard lock(process().mutex);stage=stream->stage;}
  if(stage==Stage::Ready){
    if(!publish(connection,xcb,window,property,names,transfer)){
      if(reject(stream))blocked(true);deny(connection,window,property);deleteProperty(connection,xcb,window,property);sendResult(connection,xcb,window,property,transfer,false);
    }else{sendResult(connection,xcb,window,property,transfer,true);std::lock_guard lock(process().mutex);stream->stage=Stage::Exported;releaseBuffer(*stream);}
  }else acknowledge(connection,xcb,window,property);
  return true;
}
/**
 * 中文：截获已有 INCR 的 SelectionNotify；首次通知驱动收集确认，拒绝或已过期时发送失败回执。
 * English: Intercepts SelectionNotify for existing INCR; the first receipt drives collection acknowledgement and denial/expiry sends a failure receipt.
 * 参数 / Parameters: `holdNotification(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,Transfer transfer)`.
 */
bool holdNotification(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,Transfer transfer) {
  if(!transfer.incremental)return false;
  auto stream=transfer.incremental;bool start=false,failed=false;
  {std::lock_guard lock(process().mutex);tighten(stream->strict,current());
    if(stream->stage==Stage::Collecting&&!stream->notified&&direction(true,stream->strict)&&Clock::now()<stream->deadline){stream->notified=true;start=true;}
    else failed=stream->stage==Stage::Denied;
  }
  if(start)acknowledge(connection,xcb,window,property);
  else if(failed)sendResult(connection,xcb,window,property,transfer,false);
  else if(!update(stream,names,transfer.target,true)){if(reject(stream))blocked(true);sendResult(connection,xcb,window,property,transfer,false);}
  return true;
}
/**
 * 中文：由一个读取者私有收集粘贴 INCR，其余读取者 join 同一状态，直到完整、拒绝或超时。
 * English: Lets one reader privately collect paste INCR while other readers join its state until complete, denied or timed out.
 * 参数 / Parameters: `collect(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,Transfer transfer)`.
 */
bool collect(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,Transfer transfer) {
  auto stream=transfer.incremental;
  /**
   * 中文：等待共享流离开 Collecting，等待受流截止时间及取消/拒绝状态限制。
   * English: Waits for a shared stream to leave Collecting, bounded by its deadline and cancellation/denial state.
   * 参数 / Parameters: `(const std::shared_ptr<Incremental>& existing)`.
   */
  auto join=[&](const std::shared_ptr<Incremental>& existing){std::unique_lock lock(process().mutex);while(existing->stage==Stage::Collecting&&Clock::now()<existing->deadline)process().changed.wait_until(lock,existing->deadline);return existing->stage==Stage::Ready;};
  if(stream)return join(stream);
  if(!stream){
    Property header;readProperty(connection,xcb,window,property,4,header);
    if(!header.ok||header.type!=names.incr||header.format!=32||header.count!=1||header.after||!header.bytes){
      Transfer latest;return lookup(connection,window,property,latest)&&latest.generation==transfer.generation&&latest.incremental?join(latest.incremental):false;
    }
    uint32_t hint=0;if(header.nativeLong)hint=*reinterpret_cast<unsigned long*>(header.bytes);else std::memcpy(&hint,header.bytes,4);
    bool created=false;stream=begin(connection,window,property,names,transfer,hint,&created);
    if(!stream)return false;
    if(!created)return join(stream);
    deleteProperty(connection,xcb,window,property);
    for(;;){
      if(!update(stream,names,transfer.target,false))break;
      Property metadata;readProperty(connection,xcb,window,property,0,metadata);
      if(!metadata.ok||metadata.after>stream->limit)break;
      if(!metadata.type){usleep(1000);continue;}
      Incremental scratch;if(!reserveExternal(scratch,metadata.after*(metadata.format==32&&!xcb?2:1)+sizeof(xcb_get_property_reply_t)+8))break;
      Property part;readProperty(connection,xcb,window,property,metadata.after,part);
      if(!part.ok||part.after)break;
      if(!part.type){usleep(1000);continue;}
      if(!append(stream,names,transfer.target,part.type,part.format,part.bytes,part.count,part.nativeLong,false))break;
      deleteProperty(connection,xcb,window,property);
      std::lock_guard lock(process().mutex);if(stream->stage==Stage::Ready)return true;
    }
    if(reject(stream))blocked(false);deny(connection,window,property);deleteProperty(connection,xcb,window,property);return false;
  }
  return false;
}
/**
 * 中文：取消并清除属性的已缓存传输，关联组也同步失效。
 * English: Cancels and clears a property's cached transfer, also invalidating its associated group.
 * 参数 / Parameters: `clearCache(void* connection,uint32_t window,uint32_t property)`.
 */
void clearCache(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(process().mutex);auto found=process().transfers.find({connection,window,property});
  if(found!=process().transfers.end()&&!found->second->copy&&found->second->incremental){
    auto stream=found->second->incremental;stream->stage=Stage::Deleted;releaseBuffer(*stream);process().changed.notify_all();
    if(auto group=found->second->group.lock();group&&found->second->control&&!group->complete)group->cancelled=true;
  }
}
/**
 * 中文：检查复制方向收集期限，超时拒绝并发送失败回执以避免 owner/requestor 挂起。
 * English: Checks copy-collection deadlines and denies expired transfers with failure receipts to avoid hanging owners/requestors.
 * 参数 / Parameters: `expireCopies(void* connection,bool xcb)`.
 */
void expireCopies(void* connection,bool xcb) {
  std::vector<std::pair<Key,Transfer>> expired;const auto rule=current();
  {std::lock_guard lock(process().mutex);const auto cached=process().atomCache.find({connection,xcb});for(const auto& entry:process().transfers)if(std::get<0>(entry.first)==connection&&entry.second->copy&&entry.second->incremental&&entry.second->group.expired()){
    auto stream=entry.second->incremental;tighten(stream->strict,rule);
    if(stream->stage==Stage::Collecting&&(Clock::now()>=stream->deadline||!direction(true,stream->strict)||
      cached==process().atomCache.end()||stream->bytes.size()>incrementalLimit(cached->second,entry.second->target,stream->strict))){
      stream->stage=Stage::Denied;entry.second->denied=true;releaseBuffer(*stream);
      if(stream->notified)expired.push_back({entry.first,*entry.second});blocked(true);process().changed.notify_all();
    }
  }}
  for(const auto& entry:expired)sendResult(connection,xcb,std::get<1>(entry.first),std::get<2>(entry.first),entry.second,false);
}
/**
 * 中文：判断指定连接是否有正在收集的复制 INCR，以调整事件等待的超时检查。
 * English: Tests whether the connection has collecting copy INCR so event waits can run timeout checks.
 * 参数 / Parameters: `pendingCopy(void* connection)`.
 */
bool pendingCopy(void* connection) {
  std::lock_guard lock(process().mutex);for(const auto& entry:process().transfers)if(std::get<0>(entry.first)==connection&&entry.second->copy&&entry.second->incremental&&entry.second->incremental->stage==Stage::Collecting)return true;return false;
}
/**
 * 中文：判断共享连接的事件队列是否交由 Xlib 所有，避免 XCB 抢取事件。
 * English: Tests whether Xlib owns the shared connection's event queue to avoid XCB consuming its events.
 * 参数 / Parameters: `xlibOwns(xcb_connection_t* connection)`.
 */
bool xlibOwns(xcb_connection_t* connection) {
  std::lock_guard lock(process().mutex);auto found=process().xlibConnections.find(connection);return found!=process().xlibConnections.end()&&found->second.second;
}
/**
 * 中文：隐藏尚未完成的私有粘贴属性变化事件，组整体提交后才恢复可见。
 * English: Hides property-change events for incomplete private paste data, restoring visibility after group commit.
 * 参数 / Parameters: `hiddenProperty(void* connection,uint32_t window,uint32_t property)`.
 */
/**
 * 中文：隐藏尚未完成的私有粘贴属性变化事件，组整体提交后才恢复可见。
 * English: Hides property-change events for incomplete private paste data, restoring visibility after group commit.
 */
bool hiddenProperty(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(process().mutex);auto found=process().transfers.find({connection,window,property});
  if(found==process().transfers.end()||found->second->copy||!found->second->incremental)return false;
  if(auto group=found->second->group.lock();group&&group->complete)return false;
  return true;
}
/**
 * 中文：只输出 Ready 流的完整检查结果；允许纯元数据查询，拒绝偏移读取与不足长度。
 * English: Returns only complete checked Ready content; permits metadata-only queries but refuses offsets and insufficient lengths.
 * 参数 / Parameters: `readyBuffer(const Atoms& names,const Transfer& transfer,long offset,long length,uint32_t requested, uint32_t& type,int& format,size_t& count,size_t& after,Incremental& allocation)`.
 */
bool readyBuffer(const Atoms& names,const Transfer& transfer,long offset,long length,uint32_t requested,
  uint32_t& type,int& format,size_t& count,size_t& after,Incremental& allocation) {
  auto& output=allocation.bytes;
  auto stream=transfer.incremental;if(!stream)return false;
  const auto rule=current();std::lock_guard lock(process().mutex);tighten(stream->strict,rule);
  auto group=transfer.group.lock();if(group)refreshGroup(group,rule);
  if(stream->stage!=Stage::Ready||transfer.denied||!direction(false,stream->strict)||!direction(false,rule)||offset!=0||length<0||
    (group&&(!group->complete||group->cancelled||!direction(group->copy,group->strict)))||
    (!transfer.control&&!content(names,transfer.target,stream->type,stream->format,stream->bytes.data(),stream->bytes.size()/(stream->format/8),stream->strict)))return false;
  type=stream->type;format=stream->format;size_t size=stream->bytes.size();
  if(transfer.target==names.targets&&active(rule)) {
    const auto values=reinterpret_cast<const uint32_t*>(stream->bytes.data());
    /**
     * 中文：计数当前收紧策略仍允许的 TARGETS 元素，包含组控制目标 MULTIPLE。
     * English: Counts TARGETS still permitted by the tightened policy, including the MULTIPLE group-control target.
     * 参数 / Parameters: `(uint32_t value)`.
     */
    size=std::count_if(values,values+size/4,[&](uint32_t value){return names.allowed(value,stream->strict)||value==names.multiple;})*4;
  }
  if(requested&&requested!=type){count=0;after=size;output.clear();return true;}
  if(length==0){count=0;after=size;output.clear();return true;}
  // The application receives either the whole checked selection or no bytes.
  if(size_t(length)<(size+3)/4)return false;
  if(!reserveBuffer(allocation,stream->bytes.size(),false))return false;output=stream->bytes;
  if(transfer.target==names.targets&&active(rule))output.resize(filter(names,reinterpret_cast<uint32_t*>(output.data()),output.size()/4,stream->strict)*4);
  count=size/(format/8);after=0;return true;
}
/**
 * 中文：清空原始回复后构造完整验证的 Xlib 返回缓冲，重新检查属性身份与请求删除条件。
 * English: Clears the raw reply before constructing a complete validated Xlib buffer, rechecking property identity and requested deletion conditions.
 * 参数 / Parameters: `cachedXlib(Display* display,Window window,Atom property,long offset,long length,Bool remove,Atom requested, Atom* type,int* format,unsigned long* count,unsigned long* after,unsigned char** bytes,Transfer transfer,const std::shared_ptr<Transfer>& expected)`.
 */
bool cachedXlib(Display* display,Window window,Atom property,long offset,long length,Bool remove,Atom requested,
  Atom* type,int* format,unsigned long* count,unsigned long* after,unsigned char** bytes,Transfer transfer,const std::shared_ptr<Transfer>& expected) {
  const auto names=atoms(display,false);
  if(!transfer.incremental&&*type!=names.incr&&transfer.group.expired())return false;
  if(transfer.group.expired()&&!collect(display,false,window,property,names,transfer)){if(reference(display,window,property)==expected)denyIncremental(display,window,property);blocked(false);}
  if(*bytes)XFree(*bytes);*bytes=nullptr;*type=None;*format=0;*count=0;*after=0;
  if(reference(display,window,property)!=expected){blocked(false);return true;}
  {std::lock_guard lock(process().mutex);transfer=*expected;}
  uint32_t outputType=0;int outputFormat=0;size_t outputCount=0,outputAfter=0;Incremental allocation;auto& output=allocation.bytes;
  if(!readyBuffer(names,transfer,offset,length,requested,outputType,outputFormat,outputCount,outputAfter,allocation)){blocked(false);return true;}
  const size_t size=outputFormat==32?outputCount*sizeof(unsigned long):output.size();
  Incremental returned;if(!reserveExternal(returned,size+1)){blocked(false);return true;}
  auto allocated=static_cast<unsigned char*>(calloc(size+1,1));if(!allocated){blocked(false);return true;}
  if(outputFormat==32){auto values=reinterpret_cast<unsigned long*>(allocated);for(size_t i=0;i<outputCount;++i){uint32_t value=0;std::memcpy(&value,output.data()+i*4,4);values[i]=value;}}
  else if(!output.empty())std::memcpy(allocated,output.data(),output.size());
  *type=outputType;*format=outputFormat;*count=outputCount;*after=outputAfter;*bytes=allocated;
  if(remove&&!outputAfter&&(!requested||requested==outputType))clearCache(display,window,property);
  return true;
}
/**
 * 中文：清空原始回复后构造完整验证的 XCB 返回帧，拒绝旧 cookie 对应的属性重用。
 * English: Clears the raw reply before constructing a complete validated XCB frame, refusing property reuse associated with an old cookie.
 * 参数 / Parameters: `cachedXcb(xcb_connection_t* connection,const Reply& request,xcb_get_property_reply_t** reply,Transfer transfer)`.
 */
bool cachedXcb(xcb_connection_t* connection,const Reply& request,xcb_get_property_reply_t** reply,Transfer transfer) {
  const auto names=atoms(connection,true);const auto window=std::get<1>(request.key),property=std::get<2>(request.key);
  if(!transfer.incremental&&(*reply)->type!=names.incr&&transfer.group.expired())return false;
  if(transfer.group.expired()&&!collect(connection,true,window,property,names,transfer)){if(reference(connection,window,property)==request.transfer)denyIncremental(connection,window,property);blocked(false);}
  if(reference(connection,window,property)!=request.transfer){auto value=*reply;std::memset(value+1,0,size_t(value->length)*4);value->type=0;value->format=0;value->value_len=0;value->bytes_after=0;value->length=0;blocked(false);return true;}
  {std::lock_guard lock(process().mutex);transfer=*request.transfer;}
  uint32_t type=0;int format=0;size_t count=0,after=0;Incremental allocation;auto& output=allocation.bytes;
  const bool accepted=readyBuffer(names,transfer,request.offset,request.length,request.type,type,format,count,after,allocation);
  const size_t padded=(output.size()+3)&~size_t(3);Incremental returned;
  const bool room=reserveExternal(returned,sizeof(xcb_get_property_reply_t)+padded);
  auto value=room?static_cast<xcb_get_property_reply_t*>(calloc(sizeof(xcb_get_property_reply_t)+padded,1)):nullptr;
  if(!value){auto raw=*reply;std::memset(raw+1,0,size_t(raw->length)*4);raw->type=0;raw->format=0;raw->value_len=0;raw->bytes_after=0;raw->length=0;blocked(false);return true;}
  value->response_type=1;value->sequence=(*reply)->sequence;
  if(accepted){value->type=type;value->format=format;value->value_len=count;value->bytes_after=after;value->length=padded/4;if(!output.empty())std::memcpy(value+1,output.data(),output.size());}
  else blocked(false);
  std::memset(*reply+1,0,size_t((*reply)->length)*4);free(*reply);*reply=value;
  if(accepted&&request.remove&&!after&&(!request.type||request.type==type))clearCache(connection,window,property);
  return true;
}
/**
 * 中文：通过对应 API 发送 property=None 的失败选择回执。
 * English: Sends a failure selection receipt with property=None through the corresponding API.
 * 参数 / Parameters: `notify(Display* display,const XSelectionRequestEvent& request)`.
 */
void notify(Display* display,const XSelectionRequestEvent& request) {
  CACHED_REAL(send,XSendEvent);
  XEvent event{};event.xselection={SelectionNotify,0,True,display,request.requestor,request.selection,request.target,None,request.time};
  send(display,request.requestor,False,0,&event);XFlush(display);
}
/**
 * 中文：通过对应 API 发送 property=None 的失败选择回执。
 * English: Sends a failure selection receipt with property=None through the corresponding API.
 * 参数 / Parameters: `notify(xcb_connection_t* connection,const xcb_selection_request_event_t& request)`.
 */
void notify(xcb_connection_t* connection,const xcb_selection_request_event_t& request) {
  CACHED_REAL(send,xcb_send_event);
  xcb_selection_notify_event_t event{};event.response_type=XCB_SELECTION_NOTIFY;
  event.requestor=request.requestor;event.selection=request.selection;event.target=request.target;event.time=request.time;
  std::array<char,32> bytes{};std::memcpy(bytes.data(),&event,sizeof(event));
  send(connection,0,request.requestor,0,bytes.data());xcb_flush(connection);
}
/**
 * 中文：取得连接的实际 socket 对端地址，供私有 broker 固定到同一 X 服务。
 * English: Obtains the connection's actual socket endpoint so a private broker is pinned to the same X server.
 * 参数 / Parameters: `socketPeer(xcb_connection_t* connection)`.
 */
std::string socketPeer(xcb_connection_t* connection){sockaddr_storage address{};socklen_t length=sizeof(address);
  return getpeername(xcb_get_file_descriptor(connection),reinterpret_cast<sockaddr*>(&address),&length)==0?std::string(reinterpret_cast<char*>(&address),length):std::string{};
}
/**
 * 中文：有界非阻塞连接到已捕获的 X 服务 endpoint，不重新解析可变 DISPLAY。
 * English: Connects nonblockingly with a bound to the captured X-server endpoint without resolving mutable DISPLAY again.
 * 参数 / Parameters: `brokerSocket(const std::string& endpoint)`.
 */
int brokerSocket(const std::string& endpoint){
  sockaddr_storage address{};if(endpoint.size()>sizeof(address)||endpoint.size()<sizeof(sa_family_t))return -1;
  std::memcpy(&address,endpoint.data(),endpoint.size());
  if(address.ss_family!=AF_UNIX&&address.ss_family!=AF_INET&&address.ss_family!=AF_INET6)return -1;
  const int fd=socket(address.ss_family,SOCK_STREAM|SOCK_CLOEXEC|SOCK_NONBLOCK,0);if(fd<0)return -1;
  const int result=connect(fd,reinterpret_cast<sockaddr*>(&address),endpoint.size());
  if(result<0){if(errno!=EINPROGRESS){close(fd);return -1;}pollfd waiting{fd,POLLOUT,0};int error=0;socklen_t length=sizeof(error);
    if(poll(&waiting,1,2000)<=0||getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&length)||error){close(fd);return -1;}}
  return fd;
}
/**
 * 中文：启动时保存 DISPLAY 对应的 Xauthority MIT-MAGIC-COOKIE-1 认证字节。
 * English: Captures startup DISPLAY's Xauthority MIT-MAGIC-COOKIE-1 authentication bytes.
 * 参数 / Parameters: `pinBroker()`.
 */
void pinBroker(){
  const char* display=getenv("DISPLAY");if(!display||std::strlen(display)>256)return;brokerDisplay=display;
  const char* authority=getenv("XAUTHORITY");std::string file;
  if(authority)file=authority;else if(const char* home=getenv("HOME"))file=std::string(home)+"/.Xauthority";
  if(file.empty()||file.size()>1024)return;
  int fd=open(file.c_str(),O_RDONLY|O_CLOEXEC);if(fd<0)return;struct stat info{};
  std::vector<unsigned char> bytes;
  if(fstat(fd,&info)==0&&S_ISREG(info.st_mode)&&info.st_size>0&&info.st_size<=65536){bytes.resize(info.st_size);if(pread(fd,bytes.data(),bytes.size(),0)!=ssize_t(bytes.size()))bytes.clear();}close(fd);
  const auto colon=brokerDisplay.rfind(':');if(colon==std::string::npos)return;
  const auto number=brokerDisplay.substr(colon+1,brokerDisplay.find('.',colon)-colon-1);size_t cursor=0;
  /**
   * 中文：从 Xauthority 二进制记录读取一个大端长度字段，边界错误返回失败。
   * English: Reads one big-endian length-prefixed Xauthority field, failing on bounds errors.
   * 参数 / Parameters: `(std::string& output)`.
   */
  auto field=[&](std::string& output){if(cursor+2>bytes.size())return false;size_t size=bytes[cursor]*256+bytes[cursor+1];cursor+=2;if(size>bytes.size()-cursor)return false;output.assign(reinterpret_cast<char*>(bytes.data()+cursor),size);cursor+=size;return true;};
  while(cursor+2<=bytes.size()){cursor+=2;std::string address,entry,name,data;if(!field(address)||!field(entry)||!field(name)||!field(data))break;
    if(entry==number&&name=="MIT-MAGIC-COOKIE-1"&&data.size()==16){brokerAuthName=name;brokerAuthData=data;break;}}
}
/**
 * 中文：收紧组及全部子传输策略，拒绝已不允许的内容并更新失败属性对。
 * English: Tightens group/child policies, denies newly disallowed content and updates failed property pairs.
 * 参数 / Parameters: `refreshGroup(const std::shared_ptr<Group>& group,const Policy& rule)`.
 */
/**
 * 中文：收紧组及全部子传输策略，拒绝已不允许的内容并更新失败属性对。
 * English: Tightens group/child policies, denies newly disallowed content and updates failed property pairs.
 */
void refreshGroup(const std::shared_ptr<Group>& group,const Policy& rule){
  tighten(group->strict,rule);
  for(auto& pair:group->pairs){auto transfer=pair.transfer;auto stream=transfer->incremental;
    if(!stream||stream->stage!=Stage::Ready)continue;tighten(stream->strict,group->strict);
    if(!direction(group->copy,stream->strict)||!content(group->names,pair.target,stream->type,stream->format,stream->bytes.data(),stream->bytes.size()/(stream->format/8),stream->strict)){
      transfer->denied=true;stream->stage=Stage::Denied;releaseBuffer(*stream);blocked(group->copy);}
  }
  if(group->complete&&!group->cancelled&&group->parent->incremental->stage==Stage::Ready){auto stream=group->parent->incremental;stream->bytes.resize(group->pairs.size()*8);
    for(size_t i=0;i<group->pairs.size();++i){auto& pair=group->pairs[i];const uint32_t values[2]{pair.target,pair.transfer->denied?0:pair.property};std::memcpy(stream->bytes.data()+i*8,values,8);}}
}
/**
 * 中文：核对组未取消、期限未到、方向仍允许且父属性传输身份未替换。
 * English: Checks cancellation, deadline, direction permission and unchanged parent-transfer identity.
 * 参数 / Parameters: `groupLive(const std::shared_ptr<Group>& group,bool timed=true)`.
 */
/**
 * 中文：核对组未取消、期限未到、方向仍允许且父属性传输身份未替换。
 * English: Checks cancellation, deadline, direction permission and unchanged parent-transfer identity.
 */
bool groupLive(const std::shared_ptr<Group>& group,bool timed=true){std::lock_guard lock(process().mutex);tighten(group->strict,current());
  auto found=process().transfers.find({group->connection,group->window,group->property});
  return !accounting().shuttingDown.load()&&!group->cancelled&&found!=process().transfers.end()&&found->second==group->parent&&direction(group->copy,group->strict)&&(!timed||Clock::now()<group->deadline);
}
/**
 * 中文：将已校验的控制列表或子内容存入私有完整缓冲，受预算和当前策略约束。
 * English: Stores validated control lists or child content in complete private buffers under budget and current-policy constraints.
 * 参数 / Parameters: `storeGroup(const std::shared_ptr<Group>& group,const std::shared_ptr<Transfer>& transfer,uint32_t type,int format,const void* data,size_t count,bool nativeLong)`.
 */
bool storeGroup(const std::shared_ptr<Group>& group,const std::shared_ptr<Transfer>& transfer,uint32_t type,int format,const void* data,size_t count,bool nativeLong){
  std::lock_guard lock(process().mutex);tighten(group->strict,current());
  if(group->cancelled||transfer->denied||(format!=8&&format!=16&&format!=32)||!direction(group->copy,group->strict)||
    !content(group->names,transfer->target,type,format,data,count,group->strict))return false;
  auto stream=std::make_shared<Incremental>();stream->strict=group->strict;stream->type=type;stream->format=format;stream->stage=Stage::Ready;
  const size_t size=count*(format/8);if(!reserveBuffer(*stream,size))return false;stream->bytes.resize(size);
  if(format==32&&nativeLong){auto values=static_cast<const unsigned long*>(data);for(size_t i=0;i<count;++i){uint32_t item=values[i];std::memcpy(stream->bytes.data()+i*4,&item,4);}}
  else if(size)std::memcpy(stream->bytes.data(),data,size);transfer->incremental=stream;return true;
}
/**
 * 中文：处理请求窗口的 DestroyNotify，将对应组取消并唤醒等待者。
 * English: Handles DestroyNotify for the requestor window, cancelling its group and waking waiters.
 * 参数 / Parameters: `brokerEvent(const std::shared_ptr<Group>& group,const xcb_generic_event_t* event)`.
 */
void brokerEvent(const std::shared_ptr<Group>& group,const xcb_generic_event_t* event){
  if((event->response_type&127)==XCB_DESTROY_NOTIFY&&reinterpret_cast<const xcb_destroy_notify_event_t*>(event)->window==group->window){
    std::lock_guard lock(process().mutex);group->cancelled=true;process().changed.notify_all();}
}
/**
 * 中文：清除私有连接中残留事件，保持后续子请求事件匹配准确。
 * English: Drains residual private-connection events to keep subsequent child-request matching accurate.
 * 参数 / Parameters: `drainBroker(const std::shared_ptr<Group>& group,xcb_connection_t* wire)`.
 */
void drainBroker(const std::shared_ptr<Group>& group,xcb_connection_t* wire){
  CACHED_REAL(events,xcb_poll_for_event);
  while(auto event=events(wire)){brokerEvent(group,event);free(event);}
}
/**
 * 中文：移除已导出/完成的复制身份；对未完成身份保留拒绝记录并释放缓冲。
 * English: Removes exported/completed copy identities and retains denied records for unfinished identities while releasing buffers.
 * 参数 / Parameters: `finishPrivate(void* connection,uint32_t window)`.
 * 设计 / Design: 超时 owner 可能继续写晚到分块；保留拒绝身份避免忘记它后把这些写入直接放行。
 * Timed-out owners can still write late chunks; retaining denied identities prevents those writes from becoming untracked and permitted.
 */
void finishPrivate(void* connection,uint32_t window){
  std::lock_guard lock(process().mutex);const auto other=peer(connection);
  for(auto it=process().transfers.begin();it!=process().transfers.end();)if((std::get<0>(it->first)==connection||(other&&std::get<0>(it->first)==other))&&std::get<1>(it->first)==window&&it->second->copy){
    auto transfer=it->second;auto stream=transfer->incremental;
    if((stream&&stream->stage==Stage::Exported)||(!stream&&transfer->completed)){it=process().transfers.erase(it);continue;}
    // A timed-out sender may still issue late chunks. Keep a bounded denied
    // identity instead of forgetting it and allowing those writes through.
    transfer->denied=true;if(stream){stream->stage=Stage::Denied;releaseBuffer(*stream);}++it;
  }else ++it;
}
// The broker owns its event queue. No application Display lock or predicate is
// entered, and Qt's event-reader thread cannot consume these private replies.
/**
 * 中文：等待调用方已发起的私有子转换回执，校验普通或 INCR 完整内容并存入组状态。
 * English: Waits for the caller's private child-conversion receipt, validates complete ordinary or INCR content and stores it in group state.
 * 参数 / Parameters: `receiveGroup(const std::shared_ptr<Group>& group,xcb_connection_t* wire,uint32_t window,const Pair& pair,Clock::time_point until)`.
 */
bool receiveGroup(const std::shared_ptr<Group>& group,xcb_connection_t* wire,uint32_t window,const Pair& pair,Clock::time_point until){
  CACHED_REAL(events,xcb_poll_for_event);
  bool notified=false;uint32_t property=0;
  while(groupLive(group)&&Clock::now()<until){auto event=events(wire);
    if(!event){if(xcb_connection_has_error(wire))return false;pollfd fd{xcb_get_file_descriptor(wire),POLLIN,0};poll(&fd,1,10);continue;}
    brokerEvent(group,event);
    if((event->response_type&127)==XCB_SELECTION_NOTIFY){const auto& response=*reinterpret_cast<xcb_selection_notify_event_t*>(event);
      if(response.requestor==window&&response.selection==group->selection&&response.target==pair.target&&response.time==group->time){notified=true;property=response.property;}}
    free(event);if(notified)break;
  }
  if(!notified||property!=group->names.pair||!groupLive(group))return false;
  Property probe;readProperty(wire,true,window,property,0,probe);Incremental temporary;
  {std::lock_guard lock(process().mutex);tighten(group->strict,current());const auto limit=incrementalLimit(group->names,pair.target,group->strict);
    if(!probe.ok||(probe.type==group->names.incr?probe.after!=4:probe.after>limit)||!reserveExternal(temporary,probe.after+sizeof(xcb_get_property_reply_t)+3))return false;}
  Property first;readProperty(wire,true,window,property,probe.after,first);
  if(!first.ok||first.after)return false;
  if(first.type!=group->names.incr)return storeGroup(group,pair.transfer,first.type,first.format,first.bytes,first.count,false);
  if(first.format!=32||first.count!=1||!first.bytes)return false;uint32_t hint=0;std::memcpy(&hint,first.bytes,4);
  std::shared_ptr<Incremental> stream;
  {std::lock_guard lock(process().mutex);tighten(group->strict,current());stream=std::make_shared<Incremental>();stream->strict=group->strict;stream->hint=hint;
    stream->limit=incrementalLimit(group->names,pair.target,stream->strict);stream->deadline=until;
    if(!stream->limit||hint>stream->limit||!reserveBuffer(*stream,stream->limit))return false;pair.transfer->incremental=stream;}
  deleteProperty(wire,true,window,property);
  while(groupLive(group)&&Clock::now()<until){Property metadata;readProperty(wire,true,window,property,0,metadata);
    drainBroker(group,wire);if(!groupLive(group))return false;
    if(!metadata.ok||metadata.after>stream->limit)return false;if(!metadata.type){usleep(1000);continue;}
    Incremental scratch;{std::lock_guard lock(process().mutex);if(!reserveExternal(scratch,metadata.after+sizeof(xcb_get_property_reply_t)+3))return false;}
    Property part;readProperty(wire,true,window,property,metadata.after,part);
    if(!part.ok||part.after)return false;if(!part.type){usleep(1000);continue;}
    if(!append(stream,group->names,pair.target,part.type,part.format,part.bytes,part.count,false,group->copy))return false;
    deleteProperty(wire,true,window,property);{std::lock_guard lock(process().mutex);if(stream->stage==Stage::Ready)return true;}
  }return false;
}
/**
 * 中文：整体完成后发布父控制列表和允许的子内容，粘贴方向通过私有缓存提供内容。
 * English: Publishes the parent control list and allowed child content after whole-group completion, serving paste content through private caches.
 * 参数 / Parameters: `publishGroup(const std::shared_ptr<Group>& group,xcb_connection_t* wire,uint32_t property,const std::shared_ptr<Transfer>& transfer)`.
 */
bool publishGroup(const std::shared_ptr<Group>& group,xcb_connection_t* wire,uint32_t property,const std::shared_ptr<Transfer>& transfer){
  CACHED_REAL(maximum,xcb_get_maximum_request_length);
  CACHED_REAL(write,xcb_change_property_checked);CACHED_REAL(check,xcb_request_check);
  const auto limit=maximum(wire);Incremental snapshot;
  {std::lock_guard lock(process().mutex);refreshGroup(group,current());auto stream=transfer->incremental;
    if(group->cancelled||!direction(group->copy,group->strict)||!stream||stream->stage!=Stage::Ready||transfer->denied)return false;
    snapshot.type=stream->type;snapshot.format=stream->format;
    // Incoming bodies live in the validated cache, including on servers whose
    // maximum request is smaller than a complete INCR selection. The public
    // property is an empty typed placeholder; Get hooks supply one full reply.
    if(group->copy||transfer->control){if((stream->bytes.size()+3)/4+7>limit||!reserveBuffer(snapshot,stream->bytes.size(),false))return false;snapshot.bytes=stream->bytes;}
    if(transfer->target==group->names.targets&&active(group->strict)){const auto count=filter(group->names,reinterpret_cast<uint32_t*>(snapshot.bytes.data()),snapshot.bytes.size()/4,group->strict);snapshot.bytes.resize(count*4);}}
  drainBroker(group,wire);if(!groupLive(group,false))return false;
  {std::lock_guard lock(process().mutex);refreshGroup(group,current());snapshot.strict=group->strict;
    if(group->cancelled||transfer->denied||!direction(group->copy,snapshot.strict)||
      (!transfer->control&&group->copy&&!content(group->names,transfer->target,snapshot.type,snapshot.format,snapshot.bytes.data(),snapshot.bytes.size()/(snapshot.format/8),snapshot.strict)))return false;
    if(transfer->control)snapshot.bytes=transfer->incremental->bytes;}
  auto error=check(wire,write(wire,XCB_PROP_MODE_REPLACE,group->window,property,snapshot.type,snapshot.format,snapshot.bytes.size()/(snapshot.format/8),snapshot.bytes.data()));const bool ok=!error;free(error);return ok;
}
/**
 * 中文：串行取得各子目标的完整内容，复核原父列表未改变，提交组后发送唯一最终通知。
 * English: Obtains complete child-target content, rechecks the original parent list, commits the group and sends one final notification.
 * 参数 / Parameters: `runGroup(const std::shared_ptr<Group>& group,xcb_connection_t* wire)`.
 * 设计 / Design: 独立连接避免调用应用 Display 锁；子项拒绝写为 None，父身份变化或取消不提交旧内容。
 * A separate connection avoids the application's Display lock; denied children become None and replaced/cancelled parents do not commit stale content.
 */
void runGroup(const std::shared_ptr<Group>& group,xcb_connection_t* wire){
  CACHED_REAL(create,xcb_create_window_checked);CACHED_REAL(check,xcb_request_check);
  CACHED_REAL(convert,xcb_convert_selection);
  CACHED_REAL(select,xcb_change_window_attributes_checked);
  int screen=0;const auto colon=brokerDisplay.rfind(':');const auto dot=brokerDisplay.find('.',colon);if(dot!=std::string::npos)screen=std::atoi(brokerDisplay.c_str()+dot+1);
  bool valid=!xcb_connection_has_error(wire);
  if(valid){uint32_t events=XCB_EVENT_MASK_STRUCTURE_NOTIFY;auto error=check(wire,select(wire,group->window,XCB_CW_EVENT_MASK,&events));valid=!error;free(error);}
  if(valid){auto screens=xcb_setup_roots_iterator(xcb_get_setup(wire));while(screen--&&screens.rem)xcb_screen_next(&screens);valid=screens.rem!=0;
    for(auto& pair:group->pairs){if(!valid||!groupLive(group))break;bool denied;{std::lock_guard lock(process().mutex);denied=pair.transfer->denied;}if(denied)continue;
      const auto window=xcb_generate_id(wire);uint32_t mask=XCB_EVENT_MASK_PROPERTY_CHANGE;auto error=check(wire,create(wire,XCB_COPY_FROM_PARENT,window,screens.data->root,0,0,1,1,0,XCB_WINDOW_CLASS_INPUT_OUTPUT,screens.data->root_visual,XCB_CW_EVENT_MASK,&mask));
      if(error){free(error);deny(group->connection,group->window,pair.property);continue;}
      convert(wire,window,group->selection,pair.target,group->names.pair,group->time);xcb_flush(wire);
      const auto until=std::min(group->deadline,Clock::now()+std::chrono::milliseconds(sakura::IncrementalTimeoutMs));
      if(!receiveGroup(group,wire,window,pair,until)){std::lock_guard lock(process().mutex);pair.transfer->denied=true;if(auto stream=pair.transfer->incremental){stream->stage=Stage::Denied;releaseBuffer(*stream);}blocked(group->copy);}
      // Owner hooks retain private request keys until their normal stream ends.
      finishPrivate(group->connection,window);
    }
  }
  drainBroker(group,wire);bool allowed=valid&&groupLive(group,false);
  if(allowed){Property original;readProperty(wire,true,group->window,group->property,sakura::MultiplePairs*8,original);
    allowed=original.ok&&!original.after&&original.type==group->parent->incremental->type&&original.format==32&&original.count==group->original.size()&&
      (group->original.empty()||std::memcmp(original.bytes,group->original.data(),group->original.size()*4)==0);}
  {std::lock_guard lock(process().mutex);refreshGroup(group,current());allowed=allowed&&!group->cancelled&&direction(group->copy,group->strict);
    for(auto& pair:group->pairs)if(!pair.transfer->incremental||pair.transfer->incremental->stage!=Stage::Ready)pair.transfer->denied=true;
    group->complete=true;group->parent->incremental->type=group->names.pair;group->parent->incremental->format=32;group->parent->incremental->stage=allowed?Stage::Ready:Stage::Denied;
    refreshGroup(group,current());process().changed.notify_all();}
  if(allowed){for(auto& pair:group->pairs){bool denied;{std::lock_guard lock(process().mutex);denied=pair.transfer->denied;}if(!denied&&!publishGroup(group,wire,pair.property,pair.transfer)){
        std::lock_guard lock(process().mutex);pair.transfer->denied=true;if(auto stream=pair.transfer->incremental){stream->stage=Stage::Denied;releaseBuffer(*stream);}blocked(group->copy);}
    }
    allowed=publishGroup(group,wire,group->property,group->parent);}
  drainBroker(group,wire);bool cancelled;{std::lock_guard lock(process().mutex);cancelled=group->cancelled;if(!allowed){group->parent->denied=true;group->parent->incremental->stage=Stage::Denied;
      for(auto& pair:group->pairs){pair.transfer->denied=true;if(auto stream=pair.transfer->incremental){stream->stage=Stage::Denied;releaseBuffer(*stream);}}}}
  if(!cancelled)sendResult(wire,true,group->window,group->property,*group->parent,allowed);
  if(group->copy){std::lock_guard lock(process().mutex);for(auto it=process().transfers.begin();it!=process().transfers.end();)if(it->second==group->parent||it->second->group.lock()==group)it=process().transfers.erase(it);else ++it;
    for(auto it=process().groups.begin();it!=process().groups.end();)if(it->second==group)it=process().groups.erase(it);else ++it;}
  // Let a source's final property callback finish before closing its requestor.
  usleep(100000);
}
/**
 * 中文：校验 MULTIPLE 父列表与资源容量，登记全部子项并启动连接到固定 endpoint 的私有 worker。
 * English: Validates the MULTIPLE parent list and capacity, registers children and starts a private worker on the pinned endpoint.
 * 参数 / Parameters: `startGroup(void* connection,bool xcb,bool copy,uint32_t window,uint32_t property,uint32_t selection,uint32_t time,const Atoms& names)`.
 * 设计 / Design: 重复属性、嵌套 MULTIPLE、父属性复用和副作用目标均拒绝；已知 socket 与看门狗中断认证阻塞，创建失败撤销登记。
 * Duplicate properties, nested MULTIPLE, parent reuse and side-effect targets are refused; a known socket/watchdog interrupts authentication and setup failure rolls back registrations.
 */
bool startGroup(void* connection,bool xcb,bool copy,uint32_t window,uint32_t property,uint32_t selection,uint32_t time,const Atoms& names){
  reapBrokers();if(accounting().shuttingDown.load()||!property||brokerDisplay.empty())return false;
  auto wire=xcb?static_cast<xcb_connection_t*>(connection):XGetXCBConnection(static_cast<Display*>(connection));if(!xcb)XFlush(static_cast<Display*>(connection));
  Property list;readProperty(wire,true,window,property,sakura::MultiplePairs*8,list);
  if(!list.ok||list.after||(list.type!=names.pair&&list.type!=XA_ATOM)||list.format!=32||list.count%2||list.count>sakura::MultiplePairs*2)return false;
  auto group=std::make_shared<Group>();group->connection=connection;group->xcb=xcb;group->copy=copy;group->window=window;group->property=property;group->selection=selection;group->time=time;group->names=names;group->strict=current();group->endpoint=socketPeer(wire);
  if(group->endpoint.empty()||!direction(copy,group->strict))return false;
  group->original.resize(list.count);for(size_t i=0;i<list.count;++i){if(list.nativeLong)group->original[i]=reinterpret_cast<unsigned long*>(list.bytes)[i];else std::memcpy(&group->original[i],list.bytes+i*4,4);}
  std::map<uint32_t,size_t> properties;for(size_t i=1;i<group->original.size();i+=2)++properties[group->original[i]];
  {std::lock_guard lock(process().mutex);const auto other=peer(connection);const Key key{connection,window,property};
    auto previous=process().transfers.find(key);if(previous!=process().transfers.end())if(auto old=previous->second->group.lock();old&&old->complete)retireGroup(old);
    for(size_t i=1;i<group->original.size();i+=2){auto previous=process().transfers.find({connection,window,group->original[i]});if(previous!=process().transfers.end())if(auto old=previous->second->group.lock();old&&old->complete)retireGroup(old);}
    auto existing=process().transfers.find(key);if(existing!=process().transfers.end()&&busy(existing->second))return false;
    std::set<Group*> unique;for(const auto& entry:process().groups)unique.insert(entry.second.get());
    if(unique.size()>=sakura::MultipleGroups||accounting().brokerSlots.load()>=sakura::MultipleGroups||process().transfers.size()+(list.count/2+1)*(other?2:1)>2048)return false;
    if(!reserveExternal(group->originalAllocation,group->original.capacity()*sizeof(uint32_t)))return false;
    /**
     * 中文：把父/子属性的共享传输身份登记到当前连接及其 Xlib/XCB 别名。
     * English: Registers shared parent/child transfer identities under the connection and its Xlib/XCB alias.
     * 参数 / Parameters: `(uint32_t atom,const std::shared_ptr<Transfer>& transfer)`.
     */
    auto install=[&](uint32_t atom,const std::shared_ptr<Transfer>& transfer){process().transfers[{connection,window,atom}]=transfer;if(other)process().transfers[{other,window,atom}]=transfer;};
    group->parent=std::make_shared<Transfer>();auto parent=group->parent;parent->copy=copy;parent->target=names.multiple;parent->selection=selection;parent->time=time;parent->generation=++process().nextTransfer;parent->group=group;parent->control=true;
    parent->incremental=std::make_shared<Incremental>();parent->incremental->type=list.type;parent->incremental->format=32;parent->incremental->strict=group->strict;if(!reserveBuffer(*parent->incremental,list.count*4,false))return false;
    install(property,parent);process().groups[key]=group;if(other)process().groups[{other,window,property}]=group;
    for(size_t i=0;i<group->original.size();i+=2){const auto target=group->original[i],atom=group->original[i+1];auto child=std::make_shared<Transfer>();child->copy=copy;child->target=target;child->selection=selection;child->time=time;child->generation=++process().nextTransfer;child->group=group;
      auto existing=process().transfers.find({connection,window,atom});const bool conflict=existing!=process().transfers.end()&&busy(existing->second);
      child->denied=!target||!atom||atom==property||properties[atom]!=1||target==names.multiple||!names.allowed(target,group->strict)||std::find(names.effects.begin(),names.effects.end(),target)!=names.effects.end()||conflict;
      group->pairs.push_back({target,atom,child});if(atom&&atom!=property&&!conflict)install(atom,child);if(child->denied)blocked(copy);}
    accounting().brokerSlots.fetch_add(1);
  }
  CACHED_REAL(connectFd,xcb_connect_to_fd);CACHED_REAL(disconnect,xcb_disconnect);
  std::unique_lock transport(process().transportMutex);
  auto broker=std::make_shared<Broker>();const int inputFd=brokerSocket(group->endpoint);broker->inputFd=inputFd;broker->group=group;broker->deadline=Clock::now()+std::chrono::seconds(2);
  if(inputFd>=0)broker->fd=fcntl(inputFd,F_DUPFD_CLOEXEC,0);
  if(broker->fd<0){if(inputFd>=0)close(inputFd);std::lock_guard lock(process().mutex);retireGroup(group);accounting().brokerSlots.fetch_sub(1);return false;}
  try{std::lock_guard lock(process().mutex);if(!process().brokerWatchdog.joinable())process().brokerWatchdog=std::thread(watchBrokers);
    process().brokers.push_back(broker);
    /**
     * 中文：认证固定服务并执行完整组请求；异常拒绝全部子项，最终关闭私有连接、归还槽位并唤醒等待者。
     * English: Authenticates to the pinned service and runs the group; exceptions deny children, and final cleanup closes the private connection, returns its slot and wakes waiters.
     * 参数 / Parameters: `()`.
     */
    broker->worker=std::thread([group,broker,inputFd,connectFd,disconnect](){
      xcb_auth_info_t auth{int(brokerAuthName.size()),const_cast<char*>(brokerAuthName.data()),int(brokerAuthData.size()),const_cast<char*>(brokerAuthData.data())};
      auto privateWire=connectFd(inputFd,&auth);
      const bool ready=privateWire&&!xcb_connection_has_error(privateWire)&&socketPeer(privateWire)==group->endpoint;
      {std::lock_guard lock(process().mutex);broker->connected=ready?1:-1;if(ready)broker->deadline=group->deadline+std::chrono::seconds(2);process().changed.notify_all();}
      try{if(ready)runGroup(group,privateWire);}catch(...){bool notify=false;{std::lock_guard lock(process().mutex);notify=!group->cancelled;group->complete=true;group->parent->denied=true;group->parent->incremental->stage=Stage::Denied;
          for(auto& pair:group->pairs){pair.transfer->denied=true;if(auto stream=pair.transfer->incremental){stream->stage=Stage::Denied;releaseBuffer(*stream);}}process().changed.notify_all();}
        if(notify)sendResult(privateWire,true,group->window,group->property,*group->parent,false);}
      {std::lock_guard transport(process().transportMutex);
        {std::lock_guard lock(process().mutex);close(broker->fd);broker->fd=-1;broker->inputFd=-1;}
        if(privateWire)disconnect(privateWire);}
      {std::lock_guard lock(process().mutex);accounting().brokerSlots.fetch_sub(1);broker->done.store(true);process().changed.notify_all();}
    });}
  catch(...){std::lock_guard lock(process().mutex);close(inputFd);close(broker->fd);retireGroup(group);broker->fd=-1;broker->inputFd=-1;broker->done.store(true);accounting().brokerSlots.fetch_sub(1);return false;}
  transport.unlock();
  // Authentication can block inside libxcb. A known socket plus one bounded
  // process watchdog makes setup and checked requests interruptible. The
  // caller sends setup failures through its own still-live connection.
  std::unique_lock lock(process().mutex);
  /**
   * 中文：等待私有连接认证成功/失败或组取消，不让调用方无限阻塞。
   * English: Waits for private-connection authentication success/failure or group cancellation without unbounded caller blocking.
   * 参数 / Parameters: `()`.
   */
  process().changed.wait_until(lock,broker->deadline,[&](){return broker->connected!=0||group->cancelled;});
  if(broker->connected==1)return true;
  if(broker->fd>=0)shutdown(broker->fd,SHUT_RDWR);retireGroup(group);return false;
}
/**
 * 中文：过滤内部属性事件、跟踪完成回执，并截获受管理选择请求执行复制策略或私有 MULTIPLE。
 * English: Filters internal property events, tracks completion receipts and intercepts managed requests for copy enforcement or private MULTIPLE.
 * 参数 / Parameters: `observe(Display* display,XEvent* event)`.
 */
bool observe(Display* display,XEvent* event) {
  if(!configured)return true;
  expireCopies(display,false);
  if(event->type==PropertyNotify&&hiddenProperty(display,event->xproperty.window,event->xproperty.atom))return false;
  if(event->type==SelectionNotify){const auto& response=event->xselection;finished(display,response.requestor,response.property,response.selection,response.target,response.time,false);}
  if(event->type!=SelectionRequest)return true;
  const auto names=atoms(display,false);const auto& request=event->xselectionrequest;
  if(!names.selection(request.selection))return true;
  const auto rule=current();
  if(request.target==names.multiple&&active(rule)){
    if(request.selection!=names.manager&&startGroup(display,false,true,request.requestor,request.property,request.selection,request.time,names))return false;
    blocked(true);notify(display,request);return false;
  }
  if(request.target==names.multiple)reuseMultiple(display,false,request.requestor,request.property,names);
  const bool tracked=remember(display,request.requestor,request.property?request.property:request.target,{true,false,uint32_t(request.target),uint32_t(request.selection),uint32_t(request.time),{}});
  if(active(rule)&&(!direction(true,rule)||!names.allowed(request.target,rule)||request.selection==names.manager||!tracked)) {
    blocked(true);notify(display,request);return false;
  }
  return true;
}
/**
 * 中文：过滤内部属性事件、跟踪完成回执，并截获受管理选择请求执行复制策略或私有 MULTIPLE。
 * English: Filters internal property events, tracks completion receipts and intercepts managed requests for copy enforcement or private MULTIPLE.
 * 参数 / Parameters: `observe(xcb_connection_t* connection,xcb_generic_event_t* event)`.
 */
bool observe(xcb_connection_t* connection,xcb_generic_event_t* event) {
  if(!configured)return true;
  // libX11 drains XCB events with its Display lock held. New XCB requests here
  // would reenter that lock. Xlib's event hooks handle its queue; Qt's explicit
  // XCBOwnsEventQueue still uses the XCB hooks.
  if(xlibOwns(connection))return true;
  expireCopies(connection,true);
  if(!event)return true;
  if((event->response_type&127)==XCB_PROPERTY_NOTIFY){const auto property=reinterpret_cast<xcb_property_notify_event_t*>(event);
    if(hiddenProperty(connection,property->window,property->atom))return false;}
  if((event->response_type&127)==XCB_SELECTION_NOTIFY){const auto& response=*reinterpret_cast<xcb_selection_notify_event_t*>(event);finished(connection,response.requestor,response.property,response.selection,response.target,response.time,false);}
  if((event->response_type&127)!=XCB_SELECTION_REQUEST)return true;
  const auto names=atoms(connection,true);const auto& request=*reinterpret_cast<xcb_selection_request_event_t*>(event);
  if(!names.selection(request.selection))return true;
  const auto rule=current();
  if(request.target==names.multiple&&active(rule)){
    if(request.selection!=names.manager&&startGroup(connection,true,true,request.requestor,request.property,request.selection,request.time,names))return false;
    blocked(true);notify(connection,request);return false;
  }
  if(request.target==names.multiple)reuseMultiple(connection,true,request.requestor,request.property,names);
  const bool tracked=remember(connection,request.requestor,request.property?request.property:request.target,{true,false,request.target,request.selection,request.time,{}});
  if(active(rule)&&(!direction(true,rule)||!names.allowed(request.target,rule)||request.selection==names.manager||!tracked)) {
    blocked(true);notify(connection,request);return false;
  }
  return true;
}
/**
 * 中文：按连接别名及可选窗口取消组/传输、清理回复与缓存，关闭连接时也移除身份映射。
 * English: Cancels groups/transfers by connection alias and optional window, clearing replies/caches and removing identity mappings on connection closure.
 * 参数 / Parameters: `forget(void* connection,uint32_t window)`.
 */
/**
 * 中文：按连接别名及可选窗口取消组/传输、清理回复与缓存，关闭连接时也移除身份映射。
 * English: Cancels groups/transfers by connection alias and optional window, clearing replies/caches and removing identity mappings on connection closure.
 */
void forget(void* connection,uint32_t window) {
  std::lock_guard lock(process().mutex);
  const auto other=peer(connection);
  for(auto it=process().groups.begin();it!=process().groups.end();)if((std::get<0>(it->first)==connection||(other&&std::get<0>(it->first)==other))&&(!window||std::get<1>(it->first)==window)){
    it->second->cancelled=true;for(auto& pair:it->second->pairs){pair.transfer->denied=true;if(auto stream=pair.transfer->incremental){stream->stage=Stage::Denied;releaseBuffer(*stream);}}it=process().groups.erase(it);
  }else ++it;
  for(auto it=process().transfers.begin();it!=process().transfers.end();) {
    if((std::get<0>(it->first)==connection||(other&&std::get<0>(it->first)==other))&&(!window||std::get<1>(it->first)==window)){
      it->second->denied=true;if(auto stream=it->second->incremental){stream->stage=Stage::Denied;releaseBuffer(*stream);}it=process().transfers.erase(it);
    }else++it;
  }
  for(auto it=process().replies.begin();it!=process().replies.end();) {
    if(!window&&(it->first.first==connection||(other&&it->first.first==other)))it=process().replies.erase(it);else++it;
  }
  if(!window){process().atomCache.erase({connection,false});process().atomCache.erase({connection,true});
    if(other){process().atomCache.erase({other,false});process().atomCache.erase({other,true});}
    for(void* pointer:{connection,other})if(pointer){process().connections.erase({pointer,false});process().connections.erase({pointer,true});}
    for(auto it=process().xlibConnections.begin();it!=process().xlibConnections.end();) {
      if(it->first==connection||it->second.first==connection)it=process().xlibConnections.erase(it);else++it;
    }}
}
/**
 * 中文：只接受绝对策略路径，并从受保护的匹配构建状态 fd 映射共享计数。
 * English: Accepts only an absolute policy path and maps shared counters only from a protected status fd with matching build identity.
 * 参数 / Parameters: `initialize()`.
 */
void initialize() {
  const char* path=getenv("SAKURA_CLIPBOARD_POLICY");
  if(!path)return;
  if(std::strlen(path)>1024||path[0]!='/')_exit(126);
  policyPath=path;configured=true;pinBroker();
  const char* value=getenv("SAKURA_CLIPBOARD_STATUS_FD");
  if(value) {
    char* end=nullptr;const long fd=std::strtol(value,&end,10);struct stat info{};
    if(end&&!*end&&fd>=3&&fd<1024&&fstat(fd,&info)==0&&S_ISREG(info.st_mode)&&
      info.st_uid==0&&!(info.st_mode&0077)&&info.st_size==sizeof(sakura::Status)) {
      auto memory=mmap(nullptr,sizeof(sakura::Status),PROT_READ|PROT_WRITE,MAP_SHARED,int(fd),0);
      if(memory!=MAP_FAILED) {
        auto proposed=static_cast<sakura::Status*>(memory);
        if(proposed->magic==sakura::Magic&&proposed->version==1&&
          proposed->build[64]==0&&std::strcmp(proposed->build,SAKURA_CLIPBOARD_BUILD)==0) {
          status=proposed;__atomic_add_fetch(&status->loaded,1,__ATOMIC_RELAXED);
        } else munmap(memory,sizeof(sakura::Status));
      }
    }
  }
}
struct Bootstrap {
  /**
   * 中文：建立进程状态、读取策略并注册 atfork 三阶段回调，注册失败立即拒绝。
   * English: Creates process state, loads policy and registers three-stage atfork callbacks, refusing on registration failure.
   * 参数 / Parameters: `Bootstrap()`.
   */
  Bootstrap(){processState=new ProcessState();initialize();
    if(configured)sensitive("");
    if(pthread_atfork(prepareFork,parentFork,childFork))_exit(126);}
  /**
   * 中文：仅在拥有状态的原进程中关闭 broker 并销毁状态，避免子进程析构继承线程。
   * English: Shuts down brokers and destroys state only in its owning process, avoiding inherited-thread destruction in a child.
   * 参数 / Parameters: `~Bootstrap()`.
   */
  ~Bootstrap(){if(processState&&processState->pid==getpid()){shutdownBrokers();delete processState;processState=nullptr;}}
} bootstrap;
}

extern "C"
/**
 * 中文：包装 Xlib owner 设置，受管理选择复制被禁时记录拒绝且不发送原请求。
 * English: Wraps Xlib ownership changes, recording refusal and suppressing the original request when managed copying is disabled.
 * 参数 / Parameters: `XSetSelectionOwner(Display* display,Atom selection,Window owner,Time time)`.
 */
int XSetSelectionOwner(Display* display,Atom selection,Window owner,Time time) {
  fresh(display,false);ORIGINAL(XSetSelectionOwner);
  if(configured&&atoms(display,false).selection(selection)&&!direction(true,current())){blocked(true);return 0;}
  return original(display,selection,owner,time);
}
extern "C"
/**
 * 中文：串行打开并登记 Xlib/XCB 双身份，缓存相同 atom 信息以保证跨 API 状态一致。
 * English: Serializes opening/registration of Xlib/XCB identities and caches shared atoms for consistent cross-API state.
 * 参数 / Parameters: `* XOpenDisplay(const char* name)`.
 */
Display* XOpenDisplay(const char* name) {
  ORIGINAL(XOpenDisplay);std::lock_guard transport(process().transportMutex);auto display=original(name);
  if(configured&&display){
    auto connection=XGetXCBConnection(display);
    if(!registerConnection(display,false)||!registerConnection(connection,true))_exit(126);
    {std::lock_guard lock(process().mutex);process().xlibConnections[connection]={display,true};}
    const auto names=atoms(display,false);
    {std::lock_guard lock(process().mutex);process().atomCache[{connection,true}]=names;}
  }
  return display;
}
extern "C"
/**
 * 中文：更新共享连接的事件队列所有权记录，再调用真实 API。
 * English: Updates shared event-queue ownership state before invoking the real API.
 * 参数 / Parameters: `XSetEventQueueOwner(Display* display,XEventQueueOwner owner)`.
 */
void XSetEventQueueOwner(Display* display,XEventQueueOwner owner) {
  fresh(display,false);ORIGINAL(XSetEventQueueOwner);
  if(configured){auto connection=XGetXCBConnection(display);
    std::lock_guard lock(process().mutex);process().xlibConnections[connection]={display,owner==XlibOwnsEventQueue};}
  original(display,owner);
}
extern "C"
/**
 * 中文：跟踪 Xlib 粘贴请求，活动 MULTIPLE 使用私有组；策略拒绝发送失败回执。
 * English: Tracks Xlib paste requests, uses private groups for active MULTIPLE and sends failure receipts on policy refusal.
 * 参数 / Parameters: `XConvertSelection(Display* display,Atom selection,Atom target,Atom property,Window requestor,Time time)`.
 */
int XConvertSelection(Display* display,Atom selection,Atom target,Atom property,Window requestor,Time time) {
  fresh(display,false);ORIGINAL(XConvertSelection);
  if(configured) {
    const auto names=atoms(display,false);
    if(names.selection(selection)) {
      const auto rule=current();
      if(target==names.multiple&&active(rule)){
        if(selection!=names.manager&&startGroup(display,false,false,requestor,property,selection,time,names))return 1;
        blocked(false);XSelectionRequestEvent request{};request.requestor=requestor;request.selection=selection;request.target=target;request.time=time;notify(display,request);return 0;
      }
      if(target==names.multiple)reuseMultiple(display,false,requestor,property,names);
      const bool tracked=remember(display,requestor,property?property:target,{false,false,uint32_t(target),uint32_t(selection),uint32_t(time),{}});
      if(active(rule)&&(!direction(false,rule)||!names.allowed(target,rule)||selection==names.manager||!tracked)) {
        blocked(false);XSelectionRequestEvent request{};request.requestor=requestor;request.selection=selection;request.target=target;request.time=time;
        notify(display,request);return 0;
      }
    }
  }
  return original(display,selection,target,property,requestor,time);
}
extern "C"
/**
 * 中文：检查受跟踪复制属性，私有收集 INCR、过滤 TARGETS，并拒绝错误或受限内容。
 * English: Checks tracked copy properties, privately collects INCR, filters TARGETS and refuses malformed or restricted content.
 * 参数 / Parameters: `XChangeProperty(Display* display,Window window,Atom property,Atom type,int format,int mode,const unsigned char* data,int length)`.
 */
int XChangeProperty(Display* display,Window window,Atom property,Atom type,int format,int mode,const unsigned char* data,int length) {
  fresh(display,false);ORIGINAL(XChangeProperty);Transfer transfer;
  if(configured&&lookup(display,window,property,transfer)&&transfer.copy) {
    const auto names=atoms(display,false);const auto rule=current();
    if(length>=0&&capture(display,false,window,property,type,format,mode,data,length,true,names,transfer))return 1;
    if((active(rule)&&transfer.denied)||!direction(true,rule)||(active(rule)&&mode!=PropModeReplace)||length<0||
      !content(names,transfer.target,type,format,data,size_t(std::max(0,length)),rule)) {
      blocked(true);deny(display,window,property);return 0;
    }
    if(active(rule)&&transfer.target==names.targets) {
      std::vector<Atom> values(reinterpret_cast<const Atom*>(data),reinterpret_cast<const Atom*>(data)+length);
      const auto count=filter(names,values.data(),values.size(),rule);
      return original(display,window,property,type,format,mode,reinterpret_cast<const unsigned char*>(values.data()),int(count));
    }
  }
  return original(display,window,property,type,format,mode,data,length);
}
extern "C"
/**
 * 中文：有界读取跟踪属性后复核传输身份，只返回完整许可内容或安全元数据。
 * English: Boundedly reads tracked properties, rechecks transfer identity and returns only complete permitted content or safe metadata.
 * 参数 / Parameters: `XGetWindowProperty(Display* display,Window window,Atom property,long offset,long length,Bool remove,Atom requested, Atom* type,int* format,unsigned long* count,unsigned long* after,unsigned char** bytes)`.
 */
int XGetWindowProperty(Display* display,Window window,Atom property,long offset,long length,Bool remove,Atom requested,
  Atom* type,int* format,unsigned long* count,unsigned long* after,unsigned char** bytes) {
  fresh(display,false);ORIGINAL(XGetWindowProperty);
  Transfer transfer;
  auto entry=configured?reference(display,window,property):nullptr;if(entry){std::lock_guard lock(process().mutex);transfer=*entry;}
  const bool tracked=entry&&!transfer.copy;
  const auto rule=tracked?current():Policy{};
  const long bounded=tracked&&active(rule)&&length>0?std::min(length,long((incrementalLimit(atoms(display,false),transfer.target,rule)+3)/4)):length;
  const int result=original(display,window,property,offset,bounded,tracked?False:remove,requested,type,format,count,after,bytes);
  if(tracked) {
    if(reference(display,window,property)!=entry){if(*bytes)XFree(*bytes);*bytes=nullptr;*type=None;*format=0;*count=0;*after=0;blocked(false);return result;}
    {std::lock_guard lock(process().mutex);transfer=*entry;}
    if(cachedXlib(display,window,property,offset,length,remove,requested,type,format,count,after,bytes,transfer,entry))return result;
    const auto names=atoms(display,false);const auto rule=current();
    const bool probe=active(rule)&&offset==0&&length==0&&metadataOnly(names,transfer.target,*type,*format,*count,*after,rule);
    if((active(rule)&&transfer.denied)||!direction(false,rule)||(active(rule)&&(offset!=0||(*after!=0&&!probe)))||
      (!probe&&!content(names,transfer.target,*type,*format,*bytes,*count,rule))) {
      if(*bytes)XFree(*bytes);
      *bytes=nullptr;*type=None;*format=0;*count=0;*after=0;blocked(false);
    } else if(active(rule)&&transfer.target==names.targets) {
      *count=filter(names,reinterpret_cast<Atom*>(*bytes),*count,rule);
    }
    if(remove&&!(*after)&&*type&&(!requested||requested==*type))deleteProperty(display,false,window,property);
  }
  return result;
}
extern "C"
/**
 * 中文：延迟未完成 INCR 的通知，拒绝时改为 None，并按精确请求身份记录完成。
 * English: Holds incomplete-INCR receipts, substitutes None on refusal and records completion by exact request identity.
 * 参数 / Parameters: `XSendEvent(Display* display,Window window,Bool propagate,long mask,XEvent* event)`.
 */
int XSendEvent(Display* display,Window window,Bool propagate,long mask,XEvent* event) {
  fresh(display,false);ORIGINAL(XSendEvent);
  if(configured&&event->type==SelectionNotify&&event->xselection.property) {
    Transfer transfer;
    if(lookup(display,event->xselection.requestor,event->xselection.property,transfer)&&transfer.copy) {
      if(holdNotification(display,false,event->xselection.requestor,event->xselection.property,atoms(display,false),transfer))return 1;
      if((transfer.denied&&active(current()))||!direction(true,current())){
        XEvent denied=*event;denied.xselection.property=None;return original(display,window,propagate,mask,&denied);
      }
    }
  }
  if(configured&&event->type==SelectionNotify){const auto& response=event->xselection;finished(display,response.requestor,response.property,response.selection,response.target,response.time,true);}
  return original(display,window,propagate,mask,event);
}
extern "C"
/**
 * 中文：等待真实事件期间检查复制超时，并循环跳过策略内部不可见事件。
 * English: Checks copy timeouts while waiting for real events and loops past policy-internal hidden events.
 * 参数 / Parameters: `XNextEvent(Display* display,XEvent* event)`.
 */
int XNextEvent(Display* display,XEvent* event) {
  fresh(display,false);ORIGINAL(XNextEvent);CACHED_REAL(pending,XPending);
  for(;;){while(configured&&pendingCopy(display)&&!pending(display)){
      expireCopies(display,false);if(!pendingCopy(display))break;
      pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);
    }
    const int result=original(display,event);if(observe(display,event))return result;
  }
}
/**
 * 中文：生成窗口/掩码/谓词事件等待包装；在等待时处理复制期限，只返回经 observe 允许的事件。
 * English: Generates window/mask/predicate event waits that enforce copy deadlines while waiting and return only events accepted by observe.
 */
#define EVENT_WAIT(name,check,signature,arguments) extern "C" int name signature {fresh(display,false);ORIGINAL(name);CACHED_REAL(available,check); \
  for(;;){bool found=false;while(configured&&pendingCopy(display)){if(available arguments){found=true;break;}expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);} \
    const int result=found?0:original arguments;if(observe(display,event))return result;}}
EVENT_WAIT(XWindowEvent,XCheckWindowEvent,(Display* display,Window window,long mask,XEvent* event),(display,window,mask,event))
EVENT_WAIT(XMaskEvent,XCheckMaskEvent,(Display* display,long mask,XEvent* event),(display,mask,event))
EVENT_WAIT(XIfEvent,XCheckIfEvent,(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value),(display,event,predicate,value))
/**
 * 中文：生成非阻塞事件检查包装，消费隐藏事件，只有可见匹配事件返回 True。
 * English: Generates nonblocking event checks that consume hidden events and return True only for visible matches.
 */
#define EVENT_CHECK(name,signature,arguments) extern "C" Bool name signature {fresh(display,false);ORIGINAL(name);while(original arguments){if(observe(display,event))return True;}return False;}
EVENT_CHECK(XCheckWindowEvent,(Display* display,Window window,long mask,XEvent* event),(display,window,mask,event))
EVENT_CHECK(XCheckMaskEvent,(Display* display,long mask,XEvent* event),(display,mask,event))
EVENT_CHECK(XCheckTypedEvent,(Display* display,int type,XEvent* event),(display,type,event))
EVENT_CHECK(XCheckTypedWindowEvent,(Display* display,Window window,int type,XEvent* event),(display,window,type,event))
EVENT_CHECK(XCheckIfEvent,(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value),(display,event,predicate,value))
extern "C"
/**
 * 中文：窥视下一条可见事件，消费被策略隐藏的事件并在等待中处理复制期限。
 * English: Peeks the next visible event, consuming hidden events and handling copy deadlines while waiting.
 * 参数 / Parameters: `XPeekEvent(Display* display,XEvent* event)`.
 */
int XPeekEvent(Display* display,XEvent* event) {
  fresh(display,false);ORIGINAL(XPeekEvent);CACHED_REAL(next,XNextEvent);CACHED_REAL(pending,XPending);
  for(;;){while(configured&&pendingCopy(display)&&!pending(display)){expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);}
    int result=original(display,event);if(observe(display,event))return result;next(display,event);}
}
extern "C"
/**
 * 中文：按调用方谓词窥视可见事件，保留有效事件队列位置并移除内部事件。
 * English: Peeks visible events by the caller's predicate, preserving valid queue positions while removing internal events.
 * 参数 / Parameters: `XPeekIfEvent(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value)`.
 */
int XPeekIfEvent(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value) {
  fresh(display,false);ORIGINAL(XPeekIfEvent);CACHED_REAL(next,XIfEvent);CACHED_REAL(available,XCheckIfEvent);CACHED_REAL(put,XPutBackEvent);
  for(;;){while(configured&&pendingCopy(display)){if(available(display,event,predicate,value)){put(display,event);break;}expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);}
    int result=original(display,event,predicate,value);if(observe(display,event))return result;next(display,event,predicate,value);}
}
extern "C"
/**
 * 中文：先取消窗口相关策略状态，再销毁真实 Xlib 窗口。
 * English: Cancels window-related policy state before destroying the real Xlib window.
 * 参数 / Parameters: `XDestroyWindow(Display* display,Window window)`.
 */
int XDestroyWindow(Display* display,Window window){fresh(display,false);ORIGINAL(XDestroyWindow);forget(display,window);return original(display,window);}
extern "C"
/**
 * 中文：清除对应完整缓存/组状态，再调用真实属性删除。
 * English: Clears the complete cache/group state before the real property deletion.
 * 参数 / Parameters: `XDeleteProperty(Display* display,Window window,Atom property)`.
 */
int XDeleteProperty(Display* display,Window window,Atom property){fresh(display,false);ORIGINAL(XDeleteProperty);if(configured)clearCache(display,window,property);return original(display,window,property);}
extern "C"
/**
 * 中文：对继承连接仅做安全拒绝；当前连接串行清理状态后真实关闭。
 * English: Safely refuses inherited-connection closure; serializes state cleanup and real closure for a current connection.
 * 参数 / Parameters: `XCloseDisplay(Display* display)`.
 */
int XCloseDisplay(Display* display){if(inherited(display,false))return 0;ORIGINAL(XCloseDisplay);std::lock_guard transport(process().transportMutex);forget(display);return original(display);}

/**
 * 中文：生成 XCB owner 设置包装；复制禁用时记录拒绝并返回无操作 cookie，不发送所有权变更。
 * English: Generates XCB ownership wrappers that record disabled-copy refusal and return a no-op cookie without changing ownership.
 */
#define SET_OWNER(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t owner,xcb_atom_t selection,xcb_timestamp_t time) { \
  fresh(connection,true);ORIGINAL(name);if(configured&&atoms(connection,true).selection(selection)&&!direction(true,current())){blocked(true);return xcb_no_operation_checked(connection);} \
  return original(connection,owner,selection,time);}
SET_OWNER(xcb_set_selection_owner)
SET_OWNER(xcb_set_selection_owner_checked)
/**
 * 中文：生成 XCB 转换包装，跟踪属性身份、使用私有 MULTIPLE 组；拒绝发送 None 回执及无操作 cookie。
 * English: Generates XCB conversion wrappers tracking property identities and using private MULTIPLE groups; refusal sends a None receipt and returns a no-op cookie.
 */
#define CONVERT(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t requestor,xcb_atom_t selection,xcb_atom_t target,xcb_atom_t property,xcb_timestamp_t time) { \
  fresh(connection,true);ORIGINAL(name);if(configured){const auto names=atoms(connection,true);if(names.selection(selection)){const auto rule=current(); \
    if(target==names.multiple&&active(rule)){if(selection!=names.manager&&startGroup(connection,true,false,requestor,property,selection,time,names))return xcb_no_operation_checked(connection); \
      blocked(false);xcb_selection_request_event_t request{};request.requestor=requestor;request.selection=selection;request.target=target;request.time=time;notify(connection,request);return xcb_no_operation_checked(connection);} \
    if(target==names.multiple)reuseMultiple(connection,true,requestor,property,names); \
    const bool tracked=remember(connection,requestor,property?property:target,{false,false,target,selection,time,{}});if(active(rule)&&(!direction(false,rule)||!names.allowed(target,rule)||selection==names.manager||!tracked)){ \
      blocked(false);xcb_selection_request_event_t request{};request.requestor=requestor;request.selection=selection;request.target=target;request.time=time;notify(connection,request);return xcb_no_operation_checked(connection);}}} \
  return original(connection,requestor,selection,target,property,time);}
CONVERT(xcb_convert_selection)
CONVERT(xcb_convert_selection_checked)
/**
 * 中文：生成 XCB 属性写入包装，收集复制 INCR、检查完整载荷并过滤 TARGETS；拒绝保留属性拒绝身份。
 * English: Generates XCB property-write wrappers collecting copy INCR, checking complete payloads and filtering TARGETS; refusal retains denied property identities.
 */
#define CHANGE(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,uint8_t mode,xcb_window_t window,xcb_atom_t property,xcb_atom_t type,uint8_t format,uint32_t length,const void* data){ \
  fresh(connection,true);ORIGINAL(name);Transfer transfer;if(configured&&lookup(connection,window,property,transfer)&&transfer.copy){const auto names=atoms(connection,true);const auto rule=current(); \
    if(capture(connection,true,window,property,type,format,mode,data,length,false,names,transfer))return xcb_no_operation_checked(connection); \
    if((active(rule)&&transfer.denied)||!direction(true,rule)||(active(rule)&&mode!=XCB_PROP_MODE_REPLACE)||!content(names,transfer.target,type,format,data,length,rule)){blocked(true);deny(connection,window,property);return xcb_no_operation_checked(connection);} \
    if(active(rule)&&transfer.target==names.targets){std::vector<uint32_t> values(static_cast<const uint32_t*>(data),static_cast<const uint32_t*>(data)+length); \
      const auto count=filter(names,values.data(),values.size(),rule);return original(connection,mode,window,property,type,format,count,values.data());}} \
  return original(connection,mode,window,property,type,format,length,data);}
CHANGE(xcb_change_property)
CHANGE(xcb_change_property_checked)
/**
 * 中文：生成属性请求包装，限制实际读取、预留最多 4096 条待回复记录，并保存共享传输身份防止 cookie 重用。
 * English: Generates property-request wrappers bounding reads, reserving up to 4096 reply records and retaining shared transfer identities against stale cookies.
 */
#define GET(name) extern "C" xcb_get_property_cookie_t name(xcb_connection_t* connection,uint8_t remove,xcb_window_t window,xcb_atom_t property,xcb_atom_t type,uint32_t offset,uint32_t length){ \
  fresh(connection,true);ORIGINAL(name);auto entry=configured?reference(connection,window,property):nullptr;Transfer transfer;if(entry){std::lock_guard lock(process().mutex);transfer=*entry;}const bool tracked=entry&&!transfer.copy; \
  bool full=false;if(tracked){std::lock_guard lock(process().mutex);full=process().replies.size()+process().pendingReplies>=4096;if(!full)++process().pendingReplies;} \
  if(full){blocked(false);return original(connection,0,window,XCB_NONE,type,0,0);} \
  const auto rule=tracked?current():Policy{};const uint32_t bounded=tracked&&active(rule)?std::min(length,uint32_t((incrementalLimit(atoms(connection,true),transfer.target,rule)+3)/4)):length; \
  const auto result=original(connection,tracked?0:remove,window,property,type,offset,bounded); \
  if(tracked){std::lock_guard lock(process().mutex);--process().pendingReplies;process().replies[{connection,result.sequence}]={{connection,window,property},offset,length,type,remove!=0,entry};} \
  return result;}
GET(xcb_get_property)
GET(xcb_get_property_unchecked)
/**
 * 中文：按 cookie 找回请求身份，清空过时/拒绝/部分回复，完整内容通过缓存与策略检查才可见。
 * English: Recovers request identity by cookie, clears stale/denied/partial replies and exposes complete content only after cache/policy checks.
 * 参数 / Parameters: `inspectReply(xcb_connection_t* connection,uint64_t sequence,void** raw)`.
 */
static void inspectReply(xcb_connection_t* connection,uint64_t sequence,void** raw) {
  if(!configured)return;
  Reply request;{std::lock_guard lock(process().mutex);auto found=process().replies.find({connection,sequence&0xffffffff});if(found==process().replies.end())return;request=found->second;process().replies.erase(found);}
  if(!raw||!*raw)return;
  const auto& key=request.key;const auto offset=request.offset,length=request.length;
  auto reply=static_cast<xcb_get_property_reply_t*>(*raw);
  auto entry=reference(connection,std::get<1>(key),std::get<2>(key));
  if(!entry||entry!=request.transfer){std::memset(reply+1,0,size_t(reply->length)*4);reply->type=0;reply->format=0;reply->value_len=0;reply->bytes_after=0;reply->length=0;blocked(false);return;}
  Transfer transfer;{std::lock_guard lock(process().mutex);transfer=*entry;}
  if(cachedXcb(connection,request,&reply,transfer)){*raw=reply;return;}
  auto bytes=reinterpret_cast<unsigned char*>(reply+1);const auto names=atoms(connection,true);const auto rule=current();
  const size_t declared=reply->format?size_t(reply->value_len)*(reply->format/8):0;
  const bool probe=active(rule)&&offset==0&&length==0&&metadataOnly(names,transfer.target,reply->type,reply->format,reply->value_len,reply->bytes_after,rule);
  if((active(rule)&&transfer.denied)||!direction(false,rule)||(active(rule)&&((reply->bytes_after!=0&&!probe)||offset!=0))||declared>size_t(reply->length)*4||
    (!probe&&!content(names,transfer.target,reply->type,reply->format,bytes,reply->value_len,rule))) {
    std::memset(bytes,0,size_t(reply->length)*4);reply->type=XCB_NONE;reply->format=0;reply->value_len=0;reply->bytes_after=0;reply->length=0;blocked(false);
  } else if(active(rule)&&transfer.target==names.targets) {
    const auto count=filter(names,reinterpret_cast<uint32_t*>(bytes),reply->value_len,rule);
    std::memset(bytes+count*4,0,size_t(reply->length)*4-count*4);reply->value_len=count;reply->length=count;
  }
  if(request.remove&&!reply->bytes_after&&reply->type&&(!request.type||request.type==reply->type))deleteProperty(connection,true,std::get<1>(key),std::get<2>(key));
}
extern "C"
/**
 * 中文：取得真实 XCB 属性回复后统一执行策略检查和缓存替换。
 * English: Obtains a real XCB property reply, then applies shared policy inspection and cache replacement.
 * 参数 / Parameters: `* xcb_get_property_reply(xcb_connection_t* connection,xcb_get_property_cookie_t cookie,xcb_generic_error_t** error)`.
 */
xcb_get_property_reply_t* xcb_get_property_reply(xcb_connection_t* connection,xcb_get_property_cookie_t cookie,xcb_generic_error_t** error){
  fresh(connection,true);ORIGINAL(xcb_get_property_reply);void* result=original(connection,cookie,error);inspectReply(connection,cookie.sequence,&result);return static_cast<xcb_get_property_reply_t*>(result);
}
extern "C"
/**
 * 中文：包装 32 位序列等待回复路径，取得回复后应用相同内容检查。
 * English: Wraps the 32-bit sequence wait path and applies the same content inspection after receiving a reply.
 * 参数 / Parameters: `* xcb_wait_for_reply(xcb_connection_t* connection,unsigned int sequence,xcb_generic_error_t** error)`.
 */
void* xcb_wait_for_reply(xcb_connection_t* connection,unsigned int sequence,xcb_generic_error_t** error){
  fresh(connection,true);ORIGINAL(xcb_wait_for_reply);auto result=original(connection,sequence,error);inspectReply(connection,sequence,&result);return result;
}
extern "C"
/**
 * 中文：包装 64 位序列等待回复路径，按记录的请求身份检查内容。
 * English: Wraps the 64-bit sequence wait path, inspecting content against the recorded request identity.
 * 参数 / Parameters: `* xcb_wait_for_reply64(xcb_connection_t* connection,uint64_t sequence,xcb_generic_error_t** error)`.
 */
void* xcb_wait_for_reply64(xcb_connection_t* connection,uint64_t sequence,xcb_generic_error_t** error){
  fresh(connection,true);ORIGINAL(xcb_wait_for_reply64);auto result=original(connection,sequence,error);inspectReply(connection,sequence,&result);return result;
}
/**
 * 中文：生成 32/64 位非阻塞回复包装；只在真实回复已取得时调用统一策略检查。
 * English: Generates 32/64-bit nonblocking reply wrappers, invoking shared inspection only after obtaining a real reply.
 */
#define POLL_REPLY(name,sequenceType) extern "C" int name(xcb_connection_t* connection,sequenceType sequence,void** reply,xcb_generic_error_t** error){ \
  fresh(connection,true);ORIGINAL(name);int result=original(connection,sequence,reply,error);if(result)inspectReply(connection,sequence,reply);return result;}
POLL_REPLY(xcb_poll_for_reply,unsigned int)
POLL_REPLY(xcb_poll_for_reply64,uint64_t)
/**
 * 中文：生成 XCB 轮询包装，释放内部隐藏事件并继续轮询，保留普通空结果。
 * English: Generates XCB polling wrappers that free hidden internal events and keep polling while preserving ordinary empty results.
 */
#define XCB_EVENT(name) extern "C" xcb_generic_event_t* name(xcb_connection_t* connection){ \
  fresh(connection,true);ORIGINAL(name);for(;;){auto event=original(connection);if(observe(connection,event))return event;free(event);}}
extern "C"
/**
 * 中文：在非 Xlib 队列拥有模式处理复制期限，跳过内部事件再返回真实可见事件。
 * English: Handles copy deadlines when Xlib does not own the queue and skips internal events before returning a visible event.
 * 参数 / Parameters: `* xcb_wait_for_event(xcb_connection_t* connection)`.
 */
xcb_generic_event_t* xcb_wait_for_event(xcb_connection_t* connection) {
  fresh(connection,true);ORIGINAL(xcb_wait_for_event);CACHED_REAL(pending,xcb_poll_for_event);
  for(;;){xcb_generic_event_t* event=nullptr;
    while(configured&&!xlibOwns(connection)&&pendingCopy(connection)){
      expireCopies(connection,true);event=pending(connection);if(event||!pendingCopy(connection))break;
      pollfd fd{xcb_get_file_descriptor(connection),POLLIN,0};poll(&fd,1,100);
    }
    if(!event)event=original(connection);if(observe(connection,event))return event;free(event);
  }
}
XCB_EVENT(xcb_poll_for_event)
XCB_EVENT(xcb_poll_for_queued_event)
/**
 * 中文：生成 XCB 事件发送包装，延迟未完成复制流通知、拒绝改为 None，并跟踪完成请求身份。
 * English: Generates XCB send-event wrappers holding unfinished copy receipts, substituting None for refusal and tracking completed request identities.
 */
#define SEND(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,uint8_t propagate,xcb_window_t destination,uint32_t mask,const char* bytes){ \
  fresh(connection,true);ORIGINAL(name);if(configured&&(static_cast<unsigned char>(bytes[0])&127)==XCB_SELECTION_NOTIFY){xcb_selection_notify_event_t event{};std::memcpy(&event,bytes,sizeof(event));Transfer transfer; \
    if(event.property&&lookup(connection,event.requestor,event.property,transfer)&&transfer.copy){ \
      if(holdNotification(connection,true,event.requestor,event.property,atoms(connection,true),transfer))return xcb_no_operation_checked(connection); \
      if((transfer.denied&&active(current()))||!direction(true,current())){std::array<char,32> denied{};std::memcpy(denied.data(),bytes,32);reinterpret_cast<xcb_selection_notify_event_t*>(denied.data())->property=0;return original(connection,propagate,destination,mask,denied.data());}} \
    finished(connection,event.requestor,event.property,event.selection,event.target,event.time,true);} \
  return original(connection,propagate,destination,mask,bytes);}
SEND(xcb_send_event)
SEND(xcb_send_event_checked)
/**
 * 中文：生成 XCB 窗口销毁包装，先取消对应传输及组，再调用真实销毁。
 * English: Generates XCB window-destruction wrappers cancelling corresponding transfers/groups before real destruction.
 */
#define DESTROY(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t window){fresh(connection,true);ORIGINAL(name);forget(connection,window);return original(connection,window);}
DESTROY(xcb_destroy_window)
DESTROY(xcb_destroy_window_checked)
/**
 * 中文：生成 XCB 属性删除包装，先清理缓存及关联组，再调用真实删除。
 * English: Generates XCB property-deletion wrappers clearing caches/associated groups before real deletion.
 */
#define DELETE(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t window,xcb_atom_t property){fresh(connection,true);ORIGINAL(name);if(configured)clearCache(connection,window,property);return original(connection,window,property);}
DELETE(xcb_delete_property)
DELETE(xcb_delete_property_checked)
extern "C"
/**
 * 中文：继承连接不真实关闭；当前连接取消所有相关状态后关闭。
 * English: Does not actually close inherited connections; cancels related state before closing current ones.
 * 参数 / Parameters: `xcb_disconnect(xcb_connection_t* connection)`.
 */
void xcb_disconnect(xcb_connection_t* connection){if(inherited(connection,true))return;ORIGINAL(xcb_disconnect);std::lock_guard transport(process().transportMutex);forget(connection);original(connection);}

extern "C"
/**
 * 中文：串行创建并登记新的 XCB 连接，身份容量超限则立即退出。
 * English: Serializes creating/registering a new XCB connection and exits on identity-capacity overflow.
 * 参数 / Parameters: `* xcb_connect(const char* display,int* screen)`.
 */
xcb_connection_t* xcb_connect(const char* display,int* screen){
  ORIGINAL(xcb_connect);std::lock_guard transport(process().transportMutex);auto connection=original(display,screen);
  if(!registerConnection(connection,true))_exit(126);
  return connection;
}
extern "C"
/**
 * 中文：用调用方认证参数创建并登记 XCB 连接，仍受进程身份容量限制。
 * English: Creates/registers an XCB connection using caller authentication, still enforcing process identity limits.
 * 参数 / Parameters: `* xcb_connect_to_display_with_auth_info(const char* display,xcb_auth_info_t* auth,int* screen)`.
 */
xcb_connection_t* xcb_connect_to_display_with_auth_info(const char* display,xcb_auth_info_t* auth,int* screen){
  ORIGINAL(xcb_connect_to_display_with_auth_info);std::lock_guard transport(process().transportMutex);auto connection=original(display,auth,screen);
  if(!registerConnection(connection,true))_exit(126);
  return connection;
}
extern "C"
/**
 * 中文：先验证 fd 不是继承连接 socket，再创建并登记新的 XCB 包装。
 * English: Checks that the fd is not an inherited-connection socket before creating/registering a new XCB wrapper.
 * 参数 / Parameters: `* xcb_connect_to_fd(int fd,xcb_auth_info_t* auth)`.
 */
xcb_connection_t* xcb_connect_to_fd(int fd,xcb_auth_info_t* auth){
  ORIGINAL(xcb_connect_to_fd);std::lock_guard transport(process().transportMutex);freshSocket(fd);auto connection=original(fd,auth);
  if(!registerConnection(connection,true))_exit(126);
  return connection;
}
