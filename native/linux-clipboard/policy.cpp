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
Counters& accounting();
bool reserveBudget(size_t amount){
  auto used=accounting().bufferBudget.load();for(;;){if(used>sakura::IncrementalBudget||amount>sakura::IncrementalBudget-used)return false;
    if(accounting().bufferBudget.compare_exchange_weak(used,used+amount))return true;}
}
template<class T> T real(const char* name) {
  auto value=reinterpret_cast<T>(dlsym(RTLD_NEXT,name));
  if (!value) _exit(126);
  return value;
}
// Constant-initialized atomic caches have no C++ initialization guard that a
// vanished thread could leave locked in a no-exec fork child.
#define CACHED_REAL(variable,name) static std::atomic<decltype(&name)> variable##Cache{nullptr}; \
  auto variable=variable##Cache.load();if(!variable){variable=real<decltype(&name)>(#name);variable##Cache.store(variable);}
#define ORIGINAL(name) CACHED_REAL(original,name)
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
bool active(const Policy& rule) { return (rule.flags&sakura::Active)!=0; }
bool direction(bool copy,const Policy& rule) {
  return !active(rule) || (rule.flags&(copy?sakura::Copy:sakura::Paste));
}
void blocked(bool copy) {
  if (status) __atomic_add_fetch(copy?&status->blockedCopy:&status->blockedPaste,1,__ATOMIC_RELAXED);
}
bool sensitive(std::string_view text) {
  for (size_t start=0;(start=text.find("eyJ",start))!=std::string::npos;) {
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
  bool selection(uint32_t atom) const { return atom==XA_PRIMARY||atom==clipboard||atom==manager; }
  bool plain(uint32_t atom) const { return atom && std::find(text.begin(),text.end(),atom)!=text.end(); }
  bool allowed(uint32_t atom,const Policy& rule) const {
    if(!active(rule))return true;
    if(!atom||atom==multiple||atom==incr||atom==save||std::find(effects.begin(),effects.end(),atom)!=effects.end())return false;
    return atom==targets||atom==timestamp||plain(atom)||((rule.flags&sakura::Files)&&!(rule.flags&sakura::Sensitive));
  }
};
constexpr std::array<const char*,17> names{"CLIPBOARD","TARGETS","TIMESTAMP","MULTIPLE","INCR","CLIPBOARD_MANAGER","SAVE_TARGETS",
  "UTF8_STRING","STRING","TEXT","text/plain","text/plain;charset=utf-8","text/plain;charset=UTF-8","ATOM_PAIR","DELETE","INSERT_SELECTION","INSERT_PROPERTY"};

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
  ~Incremental(){std::vector<unsigned char>().swap(bytes);if(reservation)owner->bufferBudget.fetch_sub(reservation);if(slot)owner->bufferSlots.fetch_sub(1);}
};
void releaseBuffer(Incremental& stream){std::vector<unsigned char>().swap(stream.bytes);if(stream.reservation){stream.owner->bufferBudget.fetch_sub(stream.reservation);stream.reservation=0;}if(stream.slot){stream.owner->bufferSlots.fetch_sub(1);stream.slot=false;}}
bool reserveBuffer(Incremental& stream,size_t amount,bool slot=true){
  if(!amount)return true;
  if(stream.reservation||(slot&&accounting().bufferSlots.load()>=sakura::IncrementalSlots)||!reserveBudget(amount))return false;
  try{stream.bytes.reserve(amount);}catch(...){accounting().bufferBudget.fetch_sub(amount);return false;}
  const auto actual=stream.bytes.capacity();
  if(actual>amount&&!reserveBudget(actual-amount)){std::vector<unsigned char>().swap(stream.bytes);accounting().bufferBudget.fetch_sub(amount);return false;}
  if(actual<amount)accounting().bufferBudget.fetch_sub(amount-actual);
  stream.owner=&accounting();stream.reservation=actual;stream.slot=slot;if(slot)accounting().bufferSlots.fetch_add(1);return true;
}
bool reserveExternal(Incremental& stream,size_t amount){if(stream.reservation||!reserveBudget(amount))return false;stream.owner=&accounting();stream.reservation=amount;return true;}
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
void recoverInherited(ProcessState& state);
ProcessState& process(){
  // _Fork/raw syscalls bypass atfork. Fail closed before touching inherited locks.
  if(!processState||processState->pid!=getpid())_exit(126);
  if(processState->recover)recoverInherited(*processState);
  return *processState;
}
Counters& accounting(){return process().counters;}
void recoverInherited(ProcessState& state){
  std::lock_guard lock(state.mutex);if(!state.recover)return;
  auto old=state.abandoned;
  // Only frozen heap objects are inspected. A lost worker's transient allocation
  // may live on an invalidated stack; it remains charged to the same 32 MiB cap.
  for(auto& entry:old->transfers)if(auto stream=entry.second->incremental)releaseBuffer(*stream);
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
bool inherited(void* connection,bool xcb){if(!configured)return false;auto& state=process();std::lock_guard lock(state.mutex);return state.inherited.count({connection,xcb})!=0;}
void fresh(void* connection,bool xcb){if(inherited(connection,xcb))_exit(126);}
void freshSocket(int fd){if(!configured)return;auto& state=process();struct stat identity{};
  std::lock_guard lock(state.mutex);if(fd>=0&&!fstat(fd,&identity)&&state.inheritedSockets.count({identity.st_dev,identity.st_ino}))_exit(126);}
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
void parentFork(){
  auto candidate=forkCandidate;forkCandidate=nullptr;
  forkSource->mutex.unlock();forkSource->transportMutex.unlock();
  delete candidate;
}
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
void watchBrokers(){while(!accounting().shuttingDown.load()){
    {std::lock_guard lock(process().mutex);for(auto& broker:process().brokers){auto group=broker->group.lock();if(broker->fd>=0&&!broker->interrupted&&
        (Clock::now()>=broker->deadline||(group&&group->cancelled))){broker->interrupted=true;shutdown(broker->fd,SHUT_RDWR);}}}
    usleep(20000);
  }}
void reapBrokers(){std::vector<std::shared_ptr<Broker>> finished;{std::lock_guard lock(process().mutex);for(auto it=process().brokers.begin();it!=process().brokers.end();)if((*it)->done.load()){finished.push_back(*it);it=process().brokers.erase(it);}else ++it;}
  for(auto& item:finished)if(item->worker.joinable())item->worker.join();}
void shutdownBrokers(){accounting().shuttingDown.store(true);std::vector<std::shared_ptr<Broker>> running;
  {std::lock_guard lock(process().mutex);for(auto& entry:process().groups)entry.second->cancelled=true;running=process().brokers;for(auto& item:running)if(item->fd>=0)shutdown(item->fd,SHUT_RDWR);}
  for(auto& item:running)if(item->worker.joinable())item->worker.join();
  if(process().brokerWatchdog.joinable())process().brokerWatchdog.join();}
void forget(void* connection,uint32_t window=0);
void refreshGroup(const std::shared_ptr<Group>& group,const Policy& rule);
// Xlib and XCB can share one connection and mix property APIs. Keep both keys
// tied to the same transfer rather than letting a toolkit switch bypass it.
void* peer(void* connection) {
  auto found=process().xlibConnections.find(static_cast<xcb_connection_t*>(connection));
  if(found!=process().xlibConnections.end())return found->second.first;
  for(const auto& item:process().xlibConnections)if(item.second.first==connection)return item.first;
  return nullptr;
}
void retireGroup(const std::shared_ptr<Group>& group){
  group->cancelled=true;
  auto discard=[](const std::shared_ptr<Transfer>& transfer){transfer->denied=true;if(auto stream=transfer->incremental){stream->stage=Stage::Deleted;releaseBuffer(*stream);}};
  discard(group->parent);for(auto& pair:group->pairs)discard(pair.transfer);
  for(auto it=process().transfers.begin();it!=process().transfers.end();)if(it->second==group->parent||it->second->group.lock()==group)it=process().transfers.erase(it);else ++it;
  for(auto it=process().groups.begin();it!=process().groups.end();)if(it->second==group)it=process().groups.erase(it);else ++it;
  process().changed.notify_all();
}
bool busy(const std::shared_ptr<Transfer>& transfer){
  if(auto group=transfer->group.lock())return !group->complete;
  if(auto stream=transfer->incremental)return stream->stage==Stage::Collecting||(stream->stage==Stage::Ready&&!transfer->completed);
  return !transfer->completed&&!transfer->denied;
}
void finished(void* connection,uint32_t window,uint32_t property,uint32_t selection,uint32_t target,uint32_t time,bool copy){
  std::lock_guard lock(process().mutex);
  for(auto& entry:process().transfers)if(std::get<0>(entry.first)==connection&&std::get<1>(entry.first)==window&&(!property||std::get<2>(entry.first)==property)){
    auto transfer=entry.second;if(transfer->copy==copy&&transfer->selection==selection&&transfer->target==target&&transfer->time==time)transfer->completed=true;
  }
}
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
std::shared_ptr<Transfer> reference(void* connection,uint32_t window,uint32_t property){std::lock_guard lock(process().mutex);auto found=process().transfers.find({connection,window,property});return found==process().transfers.end()?nullptr:found->second;}
bool lookup(void* connection,uint32_t window,uint32_t property,Transfer& value) {
  std::lock_guard lock(process().mutex);
  auto found=process().transfers.find({connection,window,property});
  if(found==process().transfers.end())return false;
  value=*found->second;return true;
}
void deny(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(process().mutex);
  auto found=process().transfers.find({connection,window,property});
  if(found!=process().transfers.end()){
    found->second->denied=true;
    if(auto stream=found->second->incremental){stream->stage=Stage::Denied;releaseBuffer(*stream);process().changed.notify_all();}
  }
}
void denyIncremental(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(process().mutex);auto found=process().transfers.find({connection,window,property});if(found==process().transfers.end())return;
  found->second->denied=true;
  if(!found->second->incremental)found->second->incremental=std::make_shared<Incremental>();
  auto stream=found->second->incremental;stream->stage=Stage::Denied;releaseBuffer(*stream);process().changed.notify_all();
}
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
bool content(const Atoms& names,uint32_t target,uint32_t type,int format,const void* bytes,size_t count,const Policy& rule) {
  try {return checkContent(names,target,type,format,bytes,count,rule);}catch(...){return false;}
}
bool metadataOnly(const Atoms& names,uint32_t target,uint32_t type,int format,size_t count,size_t after,const Policy& rule) {
  if(count||!after||!names.allowed(target,rule))return false;
  if(target==names.targets)return type==XA_ATOM&&format==32&&after<=4096*4;
  if(names.plain(target))return names.plain(type)&&format==8&&after<=rule.maximum;
  return names.allowed(type,rule)&&!(rule.flags&sakura::Sensitive)&&format>0&&after<=16*1024*1024;
}
template<class AtomType> size_t filter(const Atoms& names,AtomType* data,size_t length,const Policy& rule) {
  size_t output=0;
  for(size_t i=0;i<length;++i)if(names.allowed(data[i],rule)||data[i]==names.multiple)data[output++]=data[i];
  return output;
}
// A Display and its XCB peer always share the same buffer and state. No X11
// call is made while this mutex is held: Qt also reads events on another thread.
void tighten(Policy& accumulated,const Policy& rule) {
  if(!active(rule))return;
  if(!active(accumulated)){accumulated=rule;return;}
  accumulated.flags=sakura::Active|((accumulated.flags&rule.flags)&(sakura::Copy|sakura::Paste|sakura::Files))|
    ((accumulated.flags|rule.flags)&sakura::Sensitive);
  accumulated.maximum=std::min(accumulated.maximum,rule.maximum);
}
size_t incrementalLimit(const Atoms& names,uint32_t target,const Policy& rule) {
  if(!active(rule))return sakura::IncrementalMaximum;
  if(!names.allowed(target,rule))return 0;
  if(target==names.targets)return 4096*4;
  if(target==names.timestamp)return 4;
  return names.plain(target)?rule.maximum:sakura::IncrementalMaximum;
}
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
bool reject(const std::shared_ptr<Incremental>& stream) {
  std::lock_guard lock(process().mutex);
  if(stream->stage==Stage::Denied||stream->stage==Stage::Deleted)return false;
  stream->stage=Stage::Denied;releaseBuffer(*stream);process().changed.notify_all();return true;
}
bool update(const std::shared_ptr<Incremental>& stream,const Atoms& names,uint32_t target,bool copy) {
  std::lock_guard lock(process().mutex);tighten(stream->strict,current());
  return stream->stage==Stage::Collecting&&Clock::now()<stream->deadline&&direction(copy,stream->strict)&&
    stream->hint<=incrementalLimit(names,target,stream->strict)&&stream->bytes.size()<=incrementalLimit(names,target,stream->strict);
}
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
  ~Property(){if(bytes){if(nativeLong){CACHED_REAL(release,XFree);release(bytes);}else free(bytes);}}
};
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
void reuseMultiple(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names){
  Property list;readProperty(connection,xcb,window,property,sakura::MultiplePairs*8,list);
  if(!list.ok||list.after||(list.type!=names.pair&&list.type!=XA_ATOM)||list.format!=32||list.count%2||list.count>sakura::MultiplePairs*2)return;
  std::lock_guard lock(process().mutex);
  for(size_t i=1;i<list.count;i+=2){uint32_t atom=0;if(list.nativeLong)atom=reinterpret_cast<unsigned long*>(list.bytes)[i];else std::memcpy(&atom,list.bytes+i*4,4);
    auto previous=process().transfers.find({connection,window,atom});if(previous!=process().transfers.end())if(auto group=previous->second->group.lock();group&&group->complete)retireGroup(group);
  }
}
void deleteProperty(void* connection,bool xcb,uint32_t window,uint32_t property) {
  if(xcb){CACHED_REAL(remove,xcb_delete_property);remove(static_cast<xcb_connection_t*>(connection),window,property);xcb_flush(static_cast<xcb_connection_t*>(connection));}
  else{CACHED_REAL(remove,XDeleteProperty);remove(static_cast<Display*>(connection),window,property);XFlush(static_cast<Display*>(connection));}
}
void acknowledge(void* connection,bool xcb,uint32_t window,uint32_t property) {
  // Actual empty property deletion generates a server PropertyDelete event.
  // Synthetic PropertyNotify is ignored by some owners; no payload is exported.
  if(xcb){CACHED_REAL(write,xcb_change_property);
    write(static_cast<xcb_connection_t*>(connection),XCB_PROP_MODE_REPLACE,window,property,XCB_ATOM_INTEGER,8,0,nullptr);}
  else{CACHED_REAL(write,XChangeProperty);
    write(static_cast<Display*>(connection),window,property,XA_INTEGER,8,PropModeReplace,nullptr,0);}
  deleteProperty(connection,xcb,window,property);
}
void sendResult(void* connection,bool xcb,uint32_t window,uint32_t property,const Transfer& transfer,bool allowed) {
  if(xcb){CACHED_REAL(send,xcb_send_event);
    xcb_selection_notify_event_t event{};event.response_type=XCB_SELECTION_NOTIFY;event.requestor=window;
    event.selection=transfer.selection;event.target=transfer.target;event.time=transfer.time;event.property=allowed?property:0;
    std::array<char,32> bytes{};std::memcpy(bytes.data(),&event,sizeof(event));send(static_cast<xcb_connection_t*>(connection),0,window,0,bytes.data());xcb_flush(static_cast<xcb_connection_t*>(connection));
  }else{CACHED_REAL(send,XSendEvent);auto display=static_cast<Display*>(connection);
    XEvent event{};event.xselection={SelectionNotify,0,True,display,window,transfer.selection,transfer.target,allowed?property:None,transfer.time};
    send(display,window,False,0,&event);XFlush(display);}
}
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
bool collect(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,Transfer transfer) {
  auto stream=transfer.incremental;
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
void clearCache(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(process().mutex);auto found=process().transfers.find({connection,window,property});
  if(found!=process().transfers.end()&&!found->second->copy&&found->second->incremental){
    auto stream=found->second->incremental;stream->stage=Stage::Deleted;releaseBuffer(*stream);process().changed.notify_all();
    if(auto group=found->second->group.lock();group&&found->second->control&&!group->complete)group->cancelled=true;
  }
}
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
bool pendingCopy(void* connection) {
  std::lock_guard lock(process().mutex);for(const auto& entry:process().transfers)if(std::get<0>(entry.first)==connection&&entry.second->copy&&entry.second->incremental&&entry.second->incremental->stage==Stage::Collecting)return true;return false;
}
bool xlibOwns(xcb_connection_t* connection) {
  std::lock_guard lock(process().mutex);auto found=process().xlibConnections.find(connection);return found!=process().xlibConnections.end()&&found->second.second;
}
bool hiddenProperty(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(process().mutex);auto found=process().transfers.find({connection,window,property});
  if(found==process().transfers.end()||found->second->copy||!found->second->incremental)return false;
  if(auto group=found->second->group.lock();group&&group->complete)return false;
  return true;
}
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
    const auto values=reinterpret_cast<const uint32_t*>(stream->bytes.data());size=std::count_if(values,values+size/4,[&](uint32_t value){return names.allowed(value,stream->strict)||value==names.multiple;})*4;
  }
  if(requested&&requested!=type){count=0;after=size;output.clear();return true;}
  if(length==0){count=0;after=size;output.clear();return true;}
  // The application receives either the whole checked selection or no bytes.
  if(size_t(length)<(size+3)/4)return false;
  if(!reserveBuffer(allocation,stream->bytes.size(),false))return false;output=stream->bytes;
  if(transfer.target==names.targets&&active(rule))output.resize(filter(names,reinterpret_cast<uint32_t*>(output.data()),output.size()/4,stream->strict)*4);
  count=size/(format/8);after=0;return true;
}
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
void notify(Display* display,const XSelectionRequestEvent& request) {
  CACHED_REAL(send,XSendEvent);
  XEvent event{};event.xselection={SelectionNotify,0,True,display,request.requestor,request.selection,request.target,None,request.time};
  send(display,request.requestor,False,0,&event);XFlush(display);
}
void notify(xcb_connection_t* connection,const xcb_selection_request_event_t& request) {
  CACHED_REAL(send,xcb_send_event);
  xcb_selection_notify_event_t event{};event.response_type=XCB_SELECTION_NOTIFY;
  event.requestor=request.requestor;event.selection=request.selection;event.target=request.target;event.time=request.time;
  std::array<char,32> bytes{};std::memcpy(bytes.data(),&event,sizeof(event));
  send(connection,0,request.requestor,0,bytes.data());xcb_flush(connection);
}
std::string socketPeer(xcb_connection_t* connection){sockaddr_storage address{};socklen_t length=sizeof(address);
  return getpeername(xcb_get_file_descriptor(connection),reinterpret_cast<sockaddr*>(&address),&length)==0?std::string(reinterpret_cast<char*>(&address),length):std::string{};
}
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
  auto field=[&](std::string& output){if(cursor+2>bytes.size())return false;size_t size=bytes[cursor]*256+bytes[cursor+1];cursor+=2;if(size>bytes.size()-cursor)return false;output.assign(reinterpret_cast<char*>(bytes.data()+cursor),size);cursor+=size;return true;};
  while(cursor+2<=bytes.size()){cursor+=2;std::string address,entry,name,data;if(!field(address)||!field(entry)||!field(name)||!field(data))break;
    if(entry==number&&name=="MIT-MAGIC-COOKIE-1"&&data.size()==16){brokerAuthName=name;brokerAuthData=data;break;}}
}
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
bool groupLive(const std::shared_ptr<Group>& group,bool timed=true){std::lock_guard lock(process().mutex);tighten(group->strict,current());
  auto found=process().transfers.find({group->connection,group->window,group->property});
  return !accounting().shuttingDown.load()&&!group->cancelled&&found!=process().transfers.end()&&found->second==group->parent&&direction(group->copy,group->strict)&&(!timed||Clock::now()<group->deadline);
}
bool storeGroup(const std::shared_ptr<Group>& group,const std::shared_ptr<Transfer>& transfer,uint32_t type,int format,const void* data,size_t count,bool nativeLong){
  std::lock_guard lock(process().mutex);tighten(group->strict,current());
  if(group->cancelled||transfer->denied||(format!=8&&format!=16&&format!=32)||!direction(group->copy,group->strict)||
    !content(group->names,transfer->target,type,format,data,count,group->strict))return false;
  auto stream=std::make_shared<Incremental>();stream->strict=group->strict;stream->type=type;stream->format=format;stream->stage=Stage::Ready;
  const size_t size=count*(format/8);if(!reserveBuffer(*stream,size))return false;stream->bytes.resize(size);
  if(format==32&&nativeLong){auto values=static_cast<const unsigned long*>(data);for(size_t i=0;i<count;++i){uint32_t item=values[i];std::memcpy(stream->bytes.data()+i*4,&item,4);}}
  else if(size)std::memcpy(stream->bytes.data(),data,size);transfer->incremental=stream;return true;
}
void brokerEvent(const std::shared_ptr<Group>& group,const xcb_generic_event_t* event){
  if((event->response_type&127)==XCB_DESTROY_NOTIFY&&reinterpret_cast<const xcb_destroy_notify_event_t*>(event)->window==group->window){
    std::lock_guard lock(process().mutex);group->cancelled=true;process().changed.notify_all();}
}
void drainBroker(const std::shared_ptr<Group>& group,xcb_connection_t* wire){
  CACHED_REAL(events,xcb_poll_for_event);
  while(auto event=events(wire)){brokerEvent(group,event);free(event);}
}
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
    process().brokers.push_back(broker);broker->worker=std::thread([group,broker,inputFd,connectFd,disconnect](){
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
  std::unique_lock lock(process().mutex);process().changed.wait_until(lock,broker->deadline,[&](){return broker->connected!=0||group->cancelled;});
  if(broker->connected==1)return true;
  if(broker->fd>=0)shutdown(broker->fd,SHUT_RDWR);retireGroup(group);return false;
}
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
  Bootstrap(){processState=new ProcessState();initialize();
    if(configured)sensitive("");
    if(pthread_atfork(prepareFork,parentFork,childFork))_exit(126);}
  ~Bootstrap(){if(processState&&processState->pid==getpid()){shutdownBrokers();delete processState;processState=nullptr;}}
} bootstrap;
}

extern "C" int XSetSelectionOwner(Display* display,Atom selection,Window owner,Time time) {
  fresh(display,false);ORIGINAL(XSetSelectionOwner);
  if(configured&&atoms(display,false).selection(selection)&&!direction(true,current())){blocked(true);return 0;}
  return original(display,selection,owner,time);
}
extern "C" Display* XOpenDisplay(const char* name) {
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
extern "C" void XSetEventQueueOwner(Display* display,XEventQueueOwner owner) {
  fresh(display,false);ORIGINAL(XSetEventQueueOwner);
  if(configured){auto connection=XGetXCBConnection(display);
    std::lock_guard lock(process().mutex);process().xlibConnections[connection]={display,owner==XlibOwnsEventQueue};}
  original(display,owner);
}
extern "C" int XConvertSelection(Display* display,Atom selection,Atom target,Atom property,Window requestor,Time time) {
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
extern "C" int XChangeProperty(Display* display,Window window,Atom property,Atom type,int format,int mode,const unsigned char* data,int length) {
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
extern "C" int XGetWindowProperty(Display* display,Window window,Atom property,long offset,long length,Bool remove,Atom requested,
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
extern "C" int XSendEvent(Display* display,Window window,Bool propagate,long mask,XEvent* event) {
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
extern "C" int XNextEvent(Display* display,XEvent* event) {
  fresh(display,false);ORIGINAL(XNextEvent);CACHED_REAL(pending,XPending);
  for(;;){while(configured&&pendingCopy(display)&&!pending(display)){
      expireCopies(display,false);if(!pendingCopy(display))break;
      pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);
    }
    const int result=original(display,event);if(observe(display,event))return result;
  }
}
#define EVENT_WAIT(name,check,signature,arguments) extern "C" int name signature {fresh(display,false);ORIGINAL(name);CACHED_REAL(available,check); \
  for(;;){bool found=false;while(configured&&pendingCopy(display)){if(available arguments){found=true;break;}expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);} \
    const int result=found?0:original arguments;if(observe(display,event))return result;}}
EVENT_WAIT(XWindowEvent,XCheckWindowEvent,(Display* display,Window window,long mask,XEvent* event),(display,window,mask,event))
EVENT_WAIT(XMaskEvent,XCheckMaskEvent,(Display* display,long mask,XEvent* event),(display,mask,event))
EVENT_WAIT(XIfEvent,XCheckIfEvent,(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value),(display,event,predicate,value))
#define EVENT_CHECK(name,signature,arguments) extern "C" Bool name signature {fresh(display,false);ORIGINAL(name);while(original arguments){if(observe(display,event))return True;}return False;}
EVENT_CHECK(XCheckWindowEvent,(Display* display,Window window,long mask,XEvent* event),(display,window,mask,event))
EVENT_CHECK(XCheckMaskEvent,(Display* display,long mask,XEvent* event),(display,mask,event))
EVENT_CHECK(XCheckTypedEvent,(Display* display,int type,XEvent* event),(display,type,event))
EVENT_CHECK(XCheckTypedWindowEvent,(Display* display,Window window,int type,XEvent* event),(display,window,type,event))
EVENT_CHECK(XCheckIfEvent,(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value),(display,event,predicate,value))
extern "C" int XPeekEvent(Display* display,XEvent* event) {
  fresh(display,false);ORIGINAL(XPeekEvent);CACHED_REAL(next,XNextEvent);CACHED_REAL(pending,XPending);
  for(;;){while(configured&&pendingCopy(display)&&!pending(display)){expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);}
    int result=original(display,event);if(observe(display,event))return result;next(display,event);}
}
extern "C" int XPeekIfEvent(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value) {
  fresh(display,false);ORIGINAL(XPeekIfEvent);CACHED_REAL(next,XIfEvent);CACHED_REAL(available,XCheckIfEvent);CACHED_REAL(put,XPutBackEvent);
  for(;;){while(configured&&pendingCopy(display)){if(available(display,event,predicate,value)){put(display,event);break;}expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);}
    int result=original(display,event,predicate,value);if(observe(display,event))return result;next(display,event,predicate,value);}
}
extern "C" int XDestroyWindow(Display* display,Window window){fresh(display,false);ORIGINAL(XDestroyWindow);forget(display,window);return original(display,window);}
extern "C" int XDeleteProperty(Display* display,Window window,Atom property){fresh(display,false);ORIGINAL(XDeleteProperty);if(configured)clearCache(display,window,property);return original(display,window,property);}
extern "C" int XCloseDisplay(Display* display){if(inherited(display,false))return 0;ORIGINAL(XCloseDisplay);std::lock_guard transport(process().transportMutex);forget(display);return original(display);}

#define SET_OWNER(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t owner,xcb_atom_t selection,xcb_timestamp_t time) { \
  fresh(connection,true);ORIGINAL(name);if(configured&&atoms(connection,true).selection(selection)&&!direction(true,current())){blocked(true);return xcb_no_operation_checked(connection);} \
  return original(connection,owner,selection,time);}
SET_OWNER(xcb_set_selection_owner)
SET_OWNER(xcb_set_selection_owner_checked)
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
#define CHANGE(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,uint8_t mode,xcb_window_t window,xcb_atom_t property,xcb_atom_t type,uint8_t format,uint32_t length,const void* data){ \
  fresh(connection,true);ORIGINAL(name);Transfer transfer;if(configured&&lookup(connection,window,property,transfer)&&transfer.copy){const auto names=atoms(connection,true);const auto rule=current(); \
    if(capture(connection,true,window,property,type,format,mode,data,length,false,names,transfer))return xcb_no_operation_checked(connection); \
    if((active(rule)&&transfer.denied)||!direction(true,rule)||(active(rule)&&mode!=XCB_PROP_MODE_REPLACE)||!content(names,transfer.target,type,format,data,length,rule)){blocked(true);deny(connection,window,property);return xcb_no_operation_checked(connection);} \
    if(active(rule)&&transfer.target==names.targets){std::vector<uint32_t> values(static_cast<const uint32_t*>(data),static_cast<const uint32_t*>(data)+length); \
      const auto count=filter(names,values.data(),values.size(),rule);return original(connection,mode,window,property,type,format,count,values.data());}} \
  return original(connection,mode,window,property,type,format,length,data);}
CHANGE(xcb_change_property)
CHANGE(xcb_change_property_checked)
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
extern "C" xcb_get_property_reply_t* xcb_get_property_reply(xcb_connection_t* connection,xcb_get_property_cookie_t cookie,xcb_generic_error_t** error){
  fresh(connection,true);ORIGINAL(xcb_get_property_reply);void* result=original(connection,cookie,error);inspectReply(connection,cookie.sequence,&result);return static_cast<xcb_get_property_reply_t*>(result);
}
extern "C" void* xcb_wait_for_reply(xcb_connection_t* connection,unsigned int sequence,xcb_generic_error_t** error){
  fresh(connection,true);ORIGINAL(xcb_wait_for_reply);auto result=original(connection,sequence,error);inspectReply(connection,sequence,&result);return result;
}
extern "C" void* xcb_wait_for_reply64(xcb_connection_t* connection,uint64_t sequence,xcb_generic_error_t** error){
  fresh(connection,true);ORIGINAL(xcb_wait_for_reply64);auto result=original(connection,sequence,error);inspectReply(connection,sequence,&result);return result;
}
#define POLL_REPLY(name,sequenceType) extern "C" int name(xcb_connection_t* connection,sequenceType sequence,void** reply,xcb_generic_error_t** error){ \
  fresh(connection,true);ORIGINAL(name);int result=original(connection,sequence,reply,error);if(result)inspectReply(connection,sequence,reply);return result;}
POLL_REPLY(xcb_poll_for_reply,unsigned int)
POLL_REPLY(xcb_poll_for_reply64,uint64_t)
#define XCB_EVENT(name) extern "C" xcb_generic_event_t* name(xcb_connection_t* connection){ \
  fresh(connection,true);ORIGINAL(name);for(;;){auto event=original(connection);if(observe(connection,event))return event;free(event);}}
extern "C" xcb_generic_event_t* xcb_wait_for_event(xcb_connection_t* connection) {
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
#define SEND(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,uint8_t propagate,xcb_window_t destination,uint32_t mask,const char* bytes){ \
  fresh(connection,true);ORIGINAL(name);if(configured&&(static_cast<unsigned char>(bytes[0])&127)==XCB_SELECTION_NOTIFY){xcb_selection_notify_event_t event{};std::memcpy(&event,bytes,sizeof(event));Transfer transfer; \
    if(event.property&&lookup(connection,event.requestor,event.property,transfer)&&transfer.copy){ \
      if(holdNotification(connection,true,event.requestor,event.property,atoms(connection,true),transfer))return xcb_no_operation_checked(connection); \
      if((transfer.denied&&active(current()))||!direction(true,current())){std::array<char,32> denied{};std::memcpy(denied.data(),bytes,32);reinterpret_cast<xcb_selection_notify_event_t*>(denied.data())->property=0;return original(connection,propagate,destination,mask,denied.data());}} \
    finished(connection,event.requestor,event.property,event.selection,event.target,event.time,true);} \
  return original(connection,propagate,destination,mask,bytes);}
SEND(xcb_send_event)
SEND(xcb_send_event_checked)
#define DESTROY(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t window){fresh(connection,true);ORIGINAL(name);forget(connection,window);return original(connection,window);}
DESTROY(xcb_destroy_window)
DESTROY(xcb_destroy_window_checked)
#define DELETE(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t window,xcb_atom_t property){fresh(connection,true);ORIGINAL(name);if(configured)clearCache(connection,window,property);return original(connection,window,property);}
DELETE(xcb_delete_property)
DELETE(xcb_delete_property_checked)
extern "C" void xcb_disconnect(xcb_connection_t* connection){if(inherited(connection,true))return;ORIGINAL(xcb_disconnect);std::lock_guard transport(process().transportMutex);forget(connection);original(connection);}

extern "C" xcb_connection_t* xcb_connect(const char* display,int* screen){
  ORIGINAL(xcb_connect);std::lock_guard transport(process().transportMutex);auto connection=original(display,screen);
  if(!registerConnection(connection,true))_exit(126);
  return connection;
}
extern "C" xcb_connection_t* xcb_connect_to_display_with_auth_info(const char* display,xcb_auth_info_t* auth,int* screen){
  ORIGINAL(xcb_connect_to_display_with_auth_info);std::lock_guard transport(process().transportMutex);auto connection=original(display,auth,screen);
  if(!registerConnection(connection,true))_exit(126);
  return connection;
}
extern "C" xcb_connection_t* xcb_connect_to_fd(int fd,xcb_auth_info_t* auth){
  ORIGINAL(xcb_connect_to_fd);std::lock_guard transport(process().transportMutex);freshSocket(fd);auto connection=original(fd,auth);
  if(!registerConnection(connection,true))_exit(126);
  return connection;
}
