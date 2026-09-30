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
#include <algorithm>
#include <array>
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
#include <tuple>
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
template<class T> T real(const char* name) {
  auto value=reinterpret_cast<T>(dlsym(RTLD_NEXT,name));
  if (!value) _exit(126);
  return value;
}
#define ORIGINAL(name) static auto original=real<decltype(&name)>(#name)
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
bool sensitive(const std::string& text) {
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
  for(const auto& pattern:patterns) if(std::regex_search(text,pattern)) return true;
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
  bool selection(uint32_t atom) const { return atom==XA_PRIMARY||atom==clipboard||atom==manager; }
  bool plain(uint32_t atom) const { return atom && std::find(text.begin(),text.end(),atom)!=text.end(); }
  bool allowed(uint32_t atom,const Policy& rule) const {
    if(!active(rule))return true;
    if(!atom||atom==multiple||atom==incr||atom==save)return false;
    return atom==targets||atom==timestamp||plain(atom)||((rule.flags&sakura::Files)&&!(rule.flags&sakura::Sensitive));
  }
};
constexpr std::array<const char*,13> names{"CLIPBOARD","TARGETS","TIMESTAMP","MULTIPLE","INCR","CLIPBOARD_MANAGER","SAVE_TARGETS",
  "UTF8_STRING","STRING","TEXT","text/plain","text/plain;charset=utf-8","text/plain;charset=UTF-8"};
std::mutex mutex;
std::map<std::pair<void*,bool>,Atoms> atomCache;
std::map<xcb_connection_t*,std::pair<Display*,bool>> xlibConnections;
Atoms atoms(void* connection,bool xcb) {
  {std::lock_guard lock(mutex);auto found=atomCache.find({connection,xcb});if(found!=atomCache.end())return found->second;}
  std::array<uint32_t,13> values{};
  for(size_t i=0;i<names.size();++i) {
    if(xcb) {
      static auto intern=real<decltype(&xcb_intern_atom)>("xcb_intern_atom");
      static auto reply=real<decltype(&xcb_intern_atom_reply)>("xcb_intern_atom_reply");
      auto result=reply(static_cast<xcb_connection_t*>(connection),intern(static_cast<xcb_connection_t*>(connection),0,std::strlen(names[i]),names[i]),nullptr);
      if(result){values[i]=result->atom;free(result);}
    } else {
      static auto intern=real<decltype(&XInternAtom)>("XInternAtom");
      values[i]=intern(static_cast<Display*>(connection),names[i],False);
    }
  }
  Atoms value{values[0],values[1],values[2],values[3],values[4],values[5],values[6],{}};
  std::copy(values.begin()+7,values.end(),value.text.begin());
  {std::lock_guard lock(mutex);atomCache[{connection,xcb}]=value;}
  return value;
}
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
};
struct Transfer {
  bool copy=false,denied=false;
  uint32_t target=0,selection=0,time=0;
  std::shared_ptr<Incremental> incremental;
};
using Key=std::tuple<void*,uint32_t,uint32_t>;
std::map<Key,std::shared_ptr<Transfer>> transfers;
struct Reply {Key key;uint32_t offset,length,type;bool remove;};
std::map<std::pair<void*,uint64_t>,Reply> replies;
size_t pendingReplies=0;
std::condition_variable changed;
// Xlib and XCB can share one connection and mix property APIs. Keep both keys
// tied to the same transfer rather than letting a toolkit switch bypass it.
void* peer(void* connection) {
  auto found=xlibConnections.find(static_cast<xcb_connection_t*>(connection));
  if(found!=xlibConnections.end())return found->second.first;
  for(const auto& item:xlibConnections)if(item.second.first==connection)return item.first;
  return nullptr;
}
bool remember(void* connection,uint32_t window,uint32_t property,Transfer value) {
  std::lock_guard lock(mutex);
  const Key key{connection,window,property};
  const auto other=peer(connection);const Key alias{other,window,property};
  const size_t additional=(!transfers.count(key)?1:0)+(other&&!transfers.count(alias)?1:0);
  if(transfers.size()+additional>2048)return false;
  auto entry=std::make_shared<Transfer>(std::move(value));
  transfers[key]=entry;if(other)transfers[alias]=entry;return true;
}
bool lookup(void* connection,uint32_t window,uint32_t property,Transfer& value) {
  std::lock_guard lock(mutex);
  auto found=transfers.find({connection,window,property});
  if(found==transfers.end())return false;
  value=*found->second;return true;
}
void deny(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(mutex);
  auto found=transfers.find({connection,window,property});
  if(found!=transfers.end()){
    found->second->denied=true;
    if(auto stream=found->second->incremental){stream->stage=Stage::Denied;std::vector<unsigned char>().swap(stream->bytes);changed.notify_all();}
  }
}
void denyIncremental(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(mutex);auto found=transfers.find({connection,window,property});if(found==transfers.end())return;
  found->second->denied=true;
  if(!found->second->incremental)found->second->incremental=std::make_shared<Incremental>();
  auto stream=found->second->incremental;stream->stage=Stage::Denied;std::vector<unsigned char>().swap(stream->bytes);changed.notify_all();
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
    std::string text;
    if(type==XA_STRING) {
      text.reserve(count*2);
      for(size_t i=0;i<count;++i){unsigned c=first[i];if(c<128)text+=char(c);else{text+=char(0xc0|(c>>6));text+=char(0x80|(c&63));}}
      if(text.size()>rule.maximum)return false;
    } else {
      if(!utf8(first,count))return false;
      if(count)text.assign(static_cast<const char*>(bytes),count);
    }
    return !(rule.flags&sakura::Sensitive)||!sensitive(text);
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
  for(size_t i=0;i<length;++i)if(names.allowed(data[i],rule))data[output++]=data[i];
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
  std::lock_guard lock(mutex);
  auto found=transfers.find({connection,window,property});
  if(found==transfers.end()||found->second->denied)return {};
  if(found->second->incremental)return found->second->incremental;
  auto stream=std::make_shared<Incremental>();stream->strict=current();stream->hint=hint;
  stream->limit=incrementalLimit(names,transfer.target,stream->strict);
  size_t budget=0,slots=0;std::set<Incremental*> unique;
  for(const auto& entry:transfers)if(auto existing=entry.second->incremental;existing&&unique.insert(existing.get()).second) {
    if(existing->bytes.capacity()){budget+=existing->bytes.capacity();++slots;}
  }
  if(!direction(transfer.copy,stream->strict)||!stream->limit||hint>stream->limit||
    slots>=sakura::IncrementalSlots||budget+stream->limit>sakura::IncrementalBudget)return {};
  try {stream->bytes.reserve(stream->limit);}catch(...){return {};}
  found->second->incremental=stream;if(created)*created=true;return stream;
}
bool reject(const std::shared_ptr<Incremental>& stream) {
  std::lock_guard lock(mutex);
  if(stream->stage==Stage::Denied||stream->stage==Stage::Deleted)return false;
  stream->stage=Stage::Denied;std::vector<unsigned char>().swap(stream->bytes);changed.notify_all();return true;
}
bool update(const std::shared_ptr<Incremental>& stream,const Atoms& names,uint32_t target,bool copy) {
  std::lock_guard lock(mutex);tighten(stream->strict,current());
  return stream->stage==Stage::Collecting&&Clock::now()<stream->deadline&&direction(copy,stream->strict)&&
    stream->hint<=incrementalLimit(names,target,stream->strict)&&stream->bytes.size()<=incrementalLimit(names,target,stream->strict);
}
bool append(const std::shared_ptr<Incremental>& stream,const Atoms& names,uint32_t target,uint32_t type,int format,
  const void* data,size_t count,bool nativeLong,bool copy) {
  std::lock_guard lock(mutex);tighten(stream->strict,current());
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
  stream->stage=Stage::Ready;changed.notify_all();return true;
}
struct Property {
  uint32_t type=0;int format=0;size_t count=0,after=0;unsigned char* bytes=nullptr;bool nativeLong=false,ok=false;
  ~Property(){if(bytes){if(nativeLong){static auto release=real<decltype(&XFree)>("XFree");release(bytes);}else free(bytes);}}
};
void readProperty(void* connection,bool xcb,uint32_t window,uint32_t property,size_t limit,Property& value) {
  if(xcb){
    static auto get=real<decltype(&xcb_get_property)>("xcb_get_property");
    static auto reply=real<decltype(&xcb_get_property_reply)>("xcb_get_property_reply");
    auto raw=reply(static_cast<xcb_connection_t*>(connection),get(static_cast<xcb_connection_t*>(connection),0,window,property,XCB_GET_PROPERTY_TYPE_ANY,0,(limit+3)/4),nullptr);
    if(!raw)return;
    value.ok=true;value.type=raw->type;value.format=raw->format;value.count=raw->value_len;value.after=raw->bytes_after;
    const size_t size=(value.format==8||value.format==16||value.format==32)?value.count*(value.format/8):0;
    if(size>size_t(raw->length)*4){value.ok=false;free(raw);return;}
    // Keep the allocation rather than copying an untrusted property's payload.
    value.bytes=reinterpret_cast<unsigned char*>(raw);std::memmove(raw,raw+1,size);
  }else{
    static auto get=real<decltype(&XGetWindowProperty)>("XGetWindowProperty");
    Atom type=0;unsigned long count=0,after=0;value.nativeLong=true;
    value.ok=get(static_cast<Display*>(connection),window,property,0,(limit+3)/4,False,AnyPropertyType,
      &type,&value.format,&count,&after,&value.bytes)==Success;
    value.type=type;value.count=count;value.after=after;
  }
}
void deleteProperty(void* connection,bool xcb,uint32_t window,uint32_t property) {
  if(xcb){static auto remove=real<decltype(&xcb_delete_property)>("xcb_delete_property");remove(static_cast<xcb_connection_t*>(connection),window,property);xcb_flush(static_cast<xcb_connection_t*>(connection));}
  else{static auto remove=real<decltype(&XDeleteProperty)>("XDeleteProperty");remove(static_cast<Display*>(connection),window,property);XFlush(static_cast<Display*>(connection));}
}
void acknowledge(void* connection,bool xcb,uint32_t window,uint32_t property) {
  // Actual empty property deletion generates a server PropertyDelete event.
  // Synthetic PropertyNotify is ignored by some owners; no payload is exported.
  if(xcb){static auto write=real<decltype(&xcb_change_property)>("xcb_change_property");
    write(static_cast<xcb_connection_t*>(connection),XCB_PROP_MODE_REPLACE,window,property,XCB_ATOM_INTEGER,8,0,nullptr);}
  else{static auto write=real<decltype(&XChangeProperty)>("XChangeProperty");
    write(static_cast<Display*>(connection),window,property,XA_INTEGER,8,PropModeReplace,nullptr,0);}
  deleteProperty(connection,xcb,window,property);
}
void sendResult(void* connection,bool xcb,uint32_t window,uint32_t property,const Transfer& transfer,bool allowed) {
  if(xcb){static auto send=real<decltype(&xcb_send_event)>("xcb_send_event");
    xcb_selection_notify_event_t event{};event.response_type=XCB_SELECTION_NOTIFY;event.requestor=window;
    event.selection=transfer.selection;event.target=transfer.target;event.time=transfer.time;event.property=allowed?property:0;
    std::array<char,32> bytes{};std::memcpy(bytes.data(),&event,sizeof(event));send(static_cast<xcb_connection_t*>(connection),0,window,0,bytes.data());xcb_flush(static_cast<xcb_connection_t*>(connection));
  }else{static auto send=real<decltype(&XSendEvent)>("XSendEvent");auto display=static_cast<Display*>(connection);
    XEvent event{};event.xselection={SelectionNotify,0,True,display,window,transfer.selection,transfer.target,allowed?property:None,transfer.time};
    send(display,window,False,0,&event);XFlush(display);}
}
bool publish(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,const Transfer& transfer) {
  auto stream=transfer.incremental;auto wire=xcb?static_cast<xcb_connection_t*>(connection):XGetXCBConnection(static_cast<Display*>(connection));
  if(!xcb)XFlush(static_cast<Display*>(connection));
  static auto maximum=real<decltype(&xcb_get_maximum_request_length)>("xcb_get_maximum_request_length");
  static auto write=real<decltype(&xcb_change_property_checked)>("xcb_change_property_checked");
  static auto check=real<decltype(&xcb_request_check)>("xcb_request_check");
  const auto requestMaximum=maximum(wire);
  // Publish one complete property. If BigRequests cannot hold it, refuse it;
  // a replay of INCR could expose a prefix when rules tighten during delivery.
  std::unique_lock lock(mutex);tighten(stream->strict,current());
  if(stream->stage!=Stage::Ready||!direction(true,stream->strict)||
    !content(names,transfer.target,stream->type,stream->format,stream->bytes.data(),stream->bytes.size()/(stream->format/8),stream->strict)||
    (stream->bytes.size()+3)/4+7>requestMaximum)return false;
  if(transfer.target==names.targets&&active(stream->strict)) {
    auto values=reinterpret_cast<uint32_t*>(stream->bytes.data());const auto count=filter(names,values,stream->bytes.size()/4,stream->strict);stream->bytes.resize(count*4);
  }
  const auto type=stream->type;const auto format=stream->format;const auto count=stream->bytes.size()/(format/8);
  // Keep a bounded private snapshot while the checked XCB request runs. Xlib's
  // shared-connection locking callbacks must never reenter our state mutex.
  std::vector<unsigned char> payload;try{payload=stream->bytes;}catch(...){return false;}
  lock.unlock();const auto cookie=write(wire,XCB_PROP_MODE_REPLACE,window,property,type,format,count,payload.data());auto error=check(wire,cookie);
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
  bool notified=false;{std::lock_guard lock(mutex);notified=stream->notified;}
  if(!notified||!update(stream,names,transfer.target,true)||(mode!=PropModeReplace&&mode!=PropModeAppend)||
    !append(stream,names,transfer.target,type,format,data,count,nativeLong,true)) {
    if(reject(stream)){blocked(true);if(notified)sendResult(connection,xcb,window,property,transfer,false);}
    deny(connection,window,property);return true;
  }
  Stage stage;{std::lock_guard lock(mutex);stage=stream->stage;}
  if(stage==Stage::Ready){
    if(!publish(connection,xcb,window,property,names,transfer)){
      if(reject(stream))blocked(true);deny(connection,window,property);deleteProperty(connection,xcb,window,property);sendResult(connection,xcb,window,property,transfer,false);
    }else{sendResult(connection,xcb,window,property,transfer,true);std::lock_guard lock(mutex);stream->stage=Stage::Exported;std::vector<unsigned char>().swap(stream->bytes);}
  }else acknowledge(connection,xcb,window,property);
  return true;
}
bool holdNotification(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,Transfer transfer) {
  if(!transfer.incremental)return false;
  auto stream=transfer.incremental;bool start=false,failed=false;
  {std::lock_guard lock(mutex);tighten(stream->strict,current());
    if(stream->stage==Stage::Collecting&&!stream->notified&&direction(true,stream->strict)&&Clock::now()<stream->deadline){stream->notified=true;start=true;}
    else failed=stream->stage==Stage::Denied;
  }
  if(start)acknowledge(connection,xcb,window,property);
  else if(failed)sendResult(connection,xcb,window,property,transfer,false);
  else if(!update(stream,names,transfer.target,true)){if(reject(stream))blocked(true);sendResult(connection,xcb,window,property,transfer,false);}
  return true;
}
bool collect(void* connection,bool xcb,uint32_t window,uint32_t property,const Atoms& names,Transfer transfer) {
  lookup(connection,window,property,transfer);
  auto stream=transfer.incremental;
  auto join=[&](const std::shared_ptr<Incremental>& existing){std::unique_lock lock(mutex);while(existing->stage==Stage::Collecting&&Clock::now()<existing->deadline)changed.wait_until(lock,existing->deadline);return existing->stage==Stage::Ready;};
  if(stream)return join(stream);
  if(!stream){
    Property header;readProperty(connection,xcb,window,property,4,header);
    if(!header.ok||header.type!=names.incr||header.format!=32||header.count!=1||header.after||!header.bytes){
      lookup(connection,window,property,transfer);return transfer.incremental?join(transfer.incremental):false;
    }
    uint32_t hint=0;if(header.nativeLong)hint=*reinterpret_cast<unsigned long*>(header.bytes);else std::memcpy(&hint,header.bytes,4);
    bool created=false;stream=begin(connection,window,property,names,transfer,hint,&created);
    if(!stream)return false;
    if(!created)return join(stream);
    deleteProperty(connection,xcb,window,property);
    for(;;){
      if(!update(stream,names,transfer.target,false))break;
      Property part;readProperty(connection,xcb,window,property,stream->limit,part);
      if(!part.ok||part.after)break;
      if(!part.type){usleep(1000);continue;}
      if(!append(stream,names,transfer.target,part.type,part.format,part.bytes,part.count,part.nativeLong,false))break;
      deleteProperty(connection,xcb,window,property);
      std::lock_guard lock(mutex);if(stream->stage==Stage::Ready)return true;
    }
    if(reject(stream))blocked(false);deny(connection,window,property);deleteProperty(connection,xcb,window,property);return false;
  }
  return false;
}
void clearCache(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(mutex);auto found=transfers.find({connection,window,property});
  if(found!=transfers.end()&&!found->second->copy&&found->second->incremental){
    auto stream=found->second->incremental;stream->stage=Stage::Deleted;std::vector<unsigned char>().swap(stream->bytes);changed.notify_all();
  }
}
void expireCopies(void* connection,bool xcb) {
  std::vector<std::pair<Key,Transfer>> expired;const auto rule=current();
  {std::lock_guard lock(mutex);const auto cached=atomCache.find({connection,xcb});for(const auto& entry:transfers)if(std::get<0>(entry.first)==connection&&entry.second->copy&&entry.second->incremental){
    auto stream=entry.second->incremental;tighten(stream->strict,rule);
    if(stream->stage==Stage::Collecting&&(Clock::now()>=stream->deadline||!direction(true,stream->strict)||
      cached==atomCache.end()||stream->bytes.size()>incrementalLimit(cached->second,entry.second->target,stream->strict))){
      stream->stage=Stage::Denied;entry.second->denied=true;std::vector<unsigned char>().swap(stream->bytes);
      if(stream->notified)expired.push_back({entry.first,*entry.second});blocked(true);changed.notify_all();
    }
  }}
  for(const auto& entry:expired)sendResult(connection,xcb,std::get<1>(entry.first),std::get<2>(entry.first),entry.second,false);
}
bool pendingCopy(void* connection) {
  std::lock_guard lock(mutex);for(const auto& entry:transfers)if(std::get<0>(entry.first)==connection&&entry.second->copy&&entry.second->incremental&&entry.second->incremental->stage==Stage::Collecting)return true;return false;
}
bool xlibOwns(xcb_connection_t* connection) {
  std::lock_guard lock(mutex);auto found=xlibConnections.find(connection);return found!=xlibConnections.end()&&found->second.second;
}
bool hiddenProperty(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(mutex);auto found=transfers.find({connection,window,property});
  return found!=transfers.end()&&!found->second->copy&&found->second->incremental;
}
bool readyBuffer(const Atoms& names,const Transfer& transfer,long offset,long length,uint32_t requested,
  uint32_t& type,int& format,size_t& count,size_t& after,std::vector<unsigned char>& output) {
  auto stream=transfer.incremental;if(!stream)return false;
  const auto rule=current();std::lock_guard lock(mutex);
  if(stream->stage!=Stage::Ready||transfer.denied||!direction(false,stream->strict)||!direction(false,rule)||offset!=0||length<0||
    !content(names,transfer.target,stream->type,stream->format,stream->bytes.data(),stream->bytes.size()/(stream->format/8),rule))return false;
  type=stream->type;format=stream->format;size_t size=stream->bytes.size();
  if(transfer.target==names.targets&&active(rule)) {
    output=stream->bytes;const auto filtered=filter(names,reinterpret_cast<uint32_t*>(output.data()),size/4,rule);output.resize(filtered*4);size=output.size();
  }
  if(requested&&requested!=type){count=0;after=size;output.clear();return true;}
  if(length==0){count=0;after=size;output.clear();return true;}
  // The application receives either the whole checked selection or no bytes.
  if(size_t(length)<(size+3)/4)return false;
  count=size/(format/8);after=0;if(output.empty()&&size)output=stream->bytes;return true;
}
bool cachedXlib(Display* display,Window window,Atom property,long offset,long length,Bool remove,Atom requested,
  Atom* type,int* format,unsigned long* count,unsigned long* after,unsigned char** bytes,Transfer transfer) {
  const auto names=atoms(display,false);
  if(!transfer.incremental&&*type!=names.incr)return false;
  if(!collect(display,false,window,property,names,transfer)){denyIncremental(display,window,property);blocked(false);}
  lookup(display,window,property,transfer);
  if(*bytes)XFree(*bytes);*bytes=nullptr;*type=None;*format=0;*count=0;*after=0;
  uint32_t outputType=0;int outputFormat=0;size_t outputCount=0,outputAfter=0;std::vector<unsigned char> output;
  if(!readyBuffer(names,transfer,offset,length,requested,outputType,outputFormat,outputCount,outputAfter,output)){blocked(false);return true;}
  const size_t size=outputFormat==32?outputCount*sizeof(unsigned long):output.size();
  auto allocated=static_cast<unsigned char*>(calloc(size+1,1));if(!allocated){blocked(false);return true;}
  if(outputFormat==32){auto values=reinterpret_cast<unsigned long*>(allocated);for(size_t i=0;i<outputCount;++i){uint32_t value=0;std::memcpy(&value,output.data()+i*4,4);values[i]=value;}}
  else if(!output.empty())std::memcpy(allocated,output.data(),output.size());
  *type=outputType;*format=outputFormat;*count=outputCount;*after=outputAfter;*bytes=allocated;
  if(remove&&!outputAfter&&(!requested||requested==outputType))clearCache(display,window,property);
  return true;
}
bool cachedXcb(xcb_connection_t* connection,const Reply& request,xcb_get_property_reply_t** reply,Transfer transfer) {
  const auto names=atoms(connection,true);const auto window=std::get<1>(request.key),property=std::get<2>(request.key);
  if(!transfer.incremental&&(*reply)->type!=names.incr)return false;
  if(!collect(connection,true,window,property,names,transfer)){denyIncremental(connection,window,property);blocked(false);}
  lookup(connection,window,property,transfer);
  uint32_t type=0;int format=0;size_t count=0,after=0;std::vector<unsigned char> output;
  const bool accepted=readyBuffer(names,transfer,request.offset,request.length,request.type,type,format,count,after,output);
  const size_t padded=(output.size()+3)&~size_t(3);auto value=static_cast<xcb_get_property_reply_t*>(calloc(sizeof(xcb_get_property_reply_t)+padded,1));
  if(!value){auto raw=*reply;std::memset(raw+1,0,size_t(raw->length)*4);raw->type=0;raw->format=0;raw->value_len=0;raw->bytes_after=0;raw->length=0;blocked(false);return true;}
  value->response_type=1;value->sequence=(*reply)->sequence;
  if(accepted){value->type=type;value->format=format;value->value_len=count;value->bytes_after=after;value->length=padded/4;if(!output.empty())std::memcpy(value+1,output.data(),output.size());}
  else blocked(false);
  std::memset(*reply+1,0,size_t((*reply)->length)*4);free(*reply);*reply=value;
  if(accepted&&request.remove&&!after&&(!request.type||request.type==type))clearCache(connection,window,property);
  return true;
}
void notify(Display* display,const XSelectionRequestEvent& request) {
  static auto send=real<decltype(&XSendEvent)>("XSendEvent");
  XEvent event{};event.xselection={SelectionNotify,0,True,display,request.requestor,request.selection,request.target,None,request.time};
  send(display,request.requestor,False,0,&event);XFlush(display);
}
void notify(xcb_connection_t* connection,const xcb_selection_request_event_t& request) {
  static auto send=real<decltype(&xcb_send_event)>("xcb_send_event");
  xcb_selection_notify_event_t event{};event.response_type=XCB_SELECTION_NOTIFY;
  event.requestor=request.requestor;event.selection=request.selection;event.target=request.target;event.time=request.time;
  std::array<char,32> bytes{};std::memcpy(bytes.data(),&event,sizeof(event));
  send(connection,0,request.requestor,0,bytes.data());xcb_flush(connection);
}
bool observe(Display* display,XEvent* event) {
  if(!configured)return true;
  expireCopies(display,false);
  if(event->type==PropertyNotify&&hiddenProperty(display,event->xproperty.window,event->xproperty.atom))return false;
  if(event->type!=SelectionRequest)return true;
  const auto names=atoms(display,false);const auto& request=event->xselectionrequest;
  if(!names.selection(request.selection))return true;
  const auto rule=current();
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
  if((event->response_type&127)!=XCB_SELECTION_REQUEST)return true;
  const auto names=atoms(connection,true);const auto& request=*reinterpret_cast<xcb_selection_request_event_t*>(event);
  if(!names.selection(request.selection))return true;
  const auto rule=current();
  const bool tracked=remember(connection,request.requestor,request.property?request.property:request.target,{true,false,request.target,request.selection,request.time,{}});
  if(active(rule)&&(!direction(true,rule)||!names.allowed(request.target,rule)||request.selection==names.manager||!tracked)) {
    blocked(true);notify(connection,request);return false;
  }
  return true;
}
void forget(void* connection,uint32_t window=0) {
  std::lock_guard lock(mutex);
  const auto other=peer(connection);
  for(auto it=transfers.begin();it!=transfers.end();) {
    if((std::get<0>(it->first)==connection||(other&&std::get<0>(it->first)==other))&&(!window||std::get<1>(it->first)==window))it=transfers.erase(it);else++it;
  }
  for(auto it=replies.begin();it!=replies.end();) {
    if((it->first.first==connection||(other&&it->first.first==other))&&(!window||std::get<1>(it->second.key)==window))it=replies.erase(it);else++it;
  }
  if(!window){atomCache.erase({connection,false});atomCache.erase({connection,true});
    if(other){atomCache.erase({other,false});atomCache.erase({other,true});}
    for(auto it=xlibConnections.begin();it!=xlibConnections.end();) {
      if(it->first==connection||it->second.first==connection)it=xlibConnections.erase(it);else++it;
    }}
}
void initialize() {
  const char* path=getenv("SAKURA_CLIPBOARD_POLICY");
  if(!path)return;
  if(std::strlen(path)>1024||path[0]!='/')_exit(126);
  policyPath=path;configured=true;
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
struct Bootstrap { Bootstrap(){initialize();} } bootstrap;
}

extern "C" int XSetSelectionOwner(Display* display,Atom selection,Window owner,Time time) {
  ORIGINAL(XSetSelectionOwner);
  if(configured&&atoms(display,false).selection(selection)&&!direction(true,current())){blocked(true);return 0;}
  return original(display,selection,owner,time);
}
extern "C" Display* XOpenDisplay(const char* name) {
  ORIGINAL(XOpenDisplay);auto display=original(name);
  if(configured&&display){
    auto connection=XGetXCBConnection(display);
    {std::lock_guard lock(mutex);xlibConnections[connection]={display,true};}
    const auto names=atoms(display,false);
    {std::lock_guard lock(mutex);atomCache[{connection,true}]=names;}
  }
  return display;
}
extern "C" void XSetEventQueueOwner(Display* display,XEventQueueOwner owner) {
  ORIGINAL(XSetEventQueueOwner);
  if(configured){auto connection=XGetXCBConnection(display);
    std::lock_guard lock(mutex);xlibConnections[connection]={display,owner==XlibOwnsEventQueue};}
  original(display,owner);
}
extern "C" int XConvertSelection(Display* display,Atom selection,Atom target,Atom property,Window requestor,Time time) {
  ORIGINAL(XConvertSelection);
  if(configured) {
    const auto names=atoms(display,false);
    if(names.selection(selection)) {
      const auto rule=current();
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
  ORIGINAL(XChangeProperty);Transfer transfer;
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
  ORIGINAL(XGetWindowProperty);
  Transfer transfer;
  const bool tracked=configured&&lookup(display,window,property,transfer)&&!transfer.copy;
  const auto rule=tracked?current():Policy{};
  const long bounded=tracked&&active(rule)&&length>0?std::min(length,long((incrementalLimit(atoms(display,false),transfer.target,rule)+3)/4)):length;
  const int result=original(display,window,property,offset,bounded,tracked?False:remove,requested,type,format,count,after,bytes);
  if(tracked) {
    lookup(display,window,property,transfer);
    if(cachedXlib(display,window,property,offset,length,remove,requested,type,format,count,after,bytes,transfer))return result;
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
  ORIGINAL(XSendEvent);
  if(configured&&event->type==SelectionNotify&&event->xselection.property) {
    Transfer transfer;
    if(lookup(display,event->xselection.requestor,event->xselection.property,transfer)&&transfer.copy) {
      if(holdNotification(display,false,event->xselection.requestor,event->xselection.property,atoms(display,false),transfer))return 1;
      if((transfer.denied&&active(current()))||!direction(true,current())){
        XEvent denied=*event;denied.xselection.property=None;return original(display,window,propagate,mask,&denied);
      }
    }
  }
  return original(display,window,propagate,mask,event);
}
extern "C" int XNextEvent(Display* display,XEvent* event) {
  ORIGINAL(XNextEvent);static auto pending=real<decltype(&XPending)>("XPending");
  for(;;){while(configured&&pendingCopy(display)&&!pending(display)){
      expireCopies(display,false);if(!pendingCopy(display))break;
      pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);
    }
    const int result=original(display,event);if(observe(display,event))return result;
  }
}
#define EVENT_WAIT(name,check,signature,arguments) extern "C" int name signature {ORIGINAL(name);static auto available=real<decltype(&check)>(#check); \
  for(;;){bool found=false;while(configured&&pendingCopy(display)){if(available arguments){found=true;break;}expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);} \
    const int result=found?0:original arguments;if(observe(display,event))return result;}}
EVENT_WAIT(XWindowEvent,XCheckWindowEvent,(Display* display,Window window,long mask,XEvent* event),(display,window,mask,event))
EVENT_WAIT(XMaskEvent,XCheckMaskEvent,(Display* display,long mask,XEvent* event),(display,mask,event))
EVENT_WAIT(XIfEvent,XCheckIfEvent,(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value),(display,event,predicate,value))
#define EVENT_CHECK(name,signature,arguments) extern "C" Bool name signature {ORIGINAL(name);while(original arguments){if(observe(display,event))return True;}return False;}
EVENT_CHECK(XCheckWindowEvent,(Display* display,Window window,long mask,XEvent* event),(display,window,mask,event))
EVENT_CHECK(XCheckMaskEvent,(Display* display,long mask,XEvent* event),(display,mask,event))
EVENT_CHECK(XCheckTypedEvent,(Display* display,int type,XEvent* event),(display,type,event))
EVENT_CHECK(XCheckTypedWindowEvent,(Display* display,Window window,int type,XEvent* event),(display,window,type,event))
EVENT_CHECK(XCheckIfEvent,(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value),(display,event,predicate,value))
extern "C" int XPeekEvent(Display* display,XEvent* event) {
  ORIGINAL(XPeekEvent);static auto next=real<decltype(&XNextEvent)>("XNextEvent");static auto pending=real<decltype(&XPending)>("XPending");
  for(;;){while(configured&&pendingCopy(display)&&!pending(display)){expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);}
    int result=original(display,event);if(observe(display,event))return result;next(display,event);}
}
extern "C" int XPeekIfEvent(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value) {
  ORIGINAL(XPeekIfEvent);static auto next=real<decltype(&XIfEvent)>("XIfEvent");static auto available=real<decltype(&XCheckIfEvent)>("XCheckIfEvent");static auto put=real<decltype(&XPutBackEvent)>("XPutBackEvent");
  for(;;){while(configured&&pendingCopy(display)){if(available(display,event,predicate,value)){put(display,event);break;}expireCopies(display,false);if(!pendingCopy(display))break;pollfd fd{ConnectionNumber(display),POLLIN,0};poll(&fd,1,100);}
    int result=original(display,event,predicate,value);if(observe(display,event))return result;next(display,event,predicate,value);}
}
extern "C" int XDestroyWindow(Display* display,Window window){ORIGINAL(XDestroyWindow);forget(display,window);return original(display,window);}
extern "C" int XDeleteProperty(Display* display,Window window,Atom property){ORIGINAL(XDeleteProperty);if(configured)clearCache(display,window,property);return original(display,window,property);}
extern "C" int XCloseDisplay(Display* display){ORIGINAL(XCloseDisplay);forget(display);return original(display);}

#define SET_OWNER(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t owner,xcb_atom_t selection,xcb_timestamp_t time) { \
  ORIGINAL(name);if(configured&&atoms(connection,true).selection(selection)&&!direction(true,current())){blocked(true);return xcb_no_operation_checked(connection);} \
  return original(connection,owner,selection,time);}
SET_OWNER(xcb_set_selection_owner)
SET_OWNER(xcb_set_selection_owner_checked)
#define CONVERT(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t requestor,xcb_atom_t selection,xcb_atom_t target,xcb_atom_t property,xcb_timestamp_t time) { \
  ORIGINAL(name);if(configured){const auto names=atoms(connection,true);if(names.selection(selection)){const auto rule=current(); \
    const bool tracked=remember(connection,requestor,property?property:target,{false,false,target,selection,time,{}});if(active(rule)&&(!direction(false,rule)||!names.allowed(target,rule)||selection==names.manager||!tracked)){ \
      blocked(false);xcb_selection_request_event_t request{};request.requestor=requestor;request.selection=selection;request.target=target;request.time=time;notify(connection,request);return xcb_no_operation_checked(connection);}}} \
  return original(connection,requestor,selection,target,property,time);}
CONVERT(xcb_convert_selection)
CONVERT(xcb_convert_selection_checked)
#define CHANGE(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,uint8_t mode,xcb_window_t window,xcb_atom_t property,xcb_atom_t type,uint8_t format,uint32_t length,const void* data){ \
  ORIGINAL(name);Transfer transfer;if(configured&&lookup(connection,window,property,transfer)&&transfer.copy){const auto names=atoms(connection,true);const auto rule=current(); \
    if(capture(connection,true,window,property,type,format,mode,data,length,false,names,transfer))return xcb_no_operation_checked(connection); \
    if((active(rule)&&transfer.denied)||!direction(true,rule)||(active(rule)&&mode!=XCB_PROP_MODE_REPLACE)||!content(names,transfer.target,type,format,data,length,rule)){blocked(true);deny(connection,window,property);return xcb_no_operation_checked(connection);} \
    if(active(rule)&&transfer.target==names.targets){std::vector<uint32_t> values(static_cast<const uint32_t*>(data),static_cast<const uint32_t*>(data)+length); \
      const auto count=filter(names,values.data(),values.size(),rule);return original(connection,mode,window,property,type,format,count,values.data());}} \
  return original(connection,mode,window,property,type,format,length,data);}
CHANGE(xcb_change_property)
CHANGE(xcb_change_property_checked)
#define GET(name) extern "C" xcb_get_property_cookie_t name(xcb_connection_t* connection,uint8_t remove,xcb_window_t window,xcb_atom_t property,xcb_atom_t type,uint32_t offset,uint32_t length){ \
  ORIGINAL(name);Transfer transfer;const bool tracked=configured&&lookup(connection,window,property,transfer)&&!transfer.copy; \
  bool full=false;if(tracked){std::lock_guard lock(mutex);full=replies.size()+pendingReplies>=4096;if(!full)++pendingReplies;} \
  if(full){blocked(false);return original(connection,0,window,XCB_NONE,type,0,0);} \
  const auto rule=tracked?current():Policy{};const uint32_t bounded=tracked&&active(rule)?std::min(length,uint32_t((incrementalLimit(atoms(connection,true),transfer.target,rule)+3)/4)):length; \
  const auto result=original(connection,tracked?0:remove,window,property,type,offset,bounded); \
  if(tracked){std::lock_guard lock(mutex);--pendingReplies;replies[{connection,result.sequence}]={{connection,window,property},offset,length,type,remove!=0};} \
  return result;}
GET(xcb_get_property)
GET(xcb_get_property_unchecked)
static void inspectReply(xcb_connection_t* connection,uint64_t sequence,void** raw) {
  if(!configured)return;
  Reply request;{std::lock_guard lock(mutex);auto found=replies.find({connection,sequence&0xffffffff});if(found==replies.end())return;request=found->second;replies.erase(found);}
  if(!raw||!*raw)return;
  const auto& key=request.key;const auto offset=request.offset,length=request.length;
  Transfer transfer;if(!lookup(connection,std::get<1>(key),std::get<2>(key),transfer))return;
  auto reply=static_cast<xcb_get_property_reply_t*>(*raw);
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
  ORIGINAL(xcb_get_property_reply);void* result=original(connection,cookie,error);inspectReply(connection,cookie.sequence,&result);return static_cast<xcb_get_property_reply_t*>(result);
}
extern "C" void* xcb_wait_for_reply(xcb_connection_t* connection,unsigned int sequence,xcb_generic_error_t** error){
  ORIGINAL(xcb_wait_for_reply);auto result=original(connection,sequence,error);inspectReply(connection,sequence,&result);return result;
}
extern "C" void* xcb_wait_for_reply64(xcb_connection_t* connection,uint64_t sequence,xcb_generic_error_t** error){
  ORIGINAL(xcb_wait_for_reply64);auto result=original(connection,sequence,error);inspectReply(connection,sequence,&result);return result;
}
#define POLL_REPLY(name,sequenceType) extern "C" int name(xcb_connection_t* connection,sequenceType sequence,void** reply,xcb_generic_error_t** error){ \
  ORIGINAL(name);int result=original(connection,sequence,reply,error);if(result)inspectReply(connection,sequence,reply);return result;}
POLL_REPLY(xcb_poll_for_reply,unsigned int)
POLL_REPLY(xcb_poll_for_reply64,uint64_t)
#define XCB_EVENT(name) extern "C" xcb_generic_event_t* name(xcb_connection_t* connection){ \
  ORIGINAL(name);for(;;){auto event=original(connection);if(observe(connection,event))return event;free(event);}}
extern "C" xcb_generic_event_t* xcb_wait_for_event(xcb_connection_t* connection) {
  ORIGINAL(xcb_wait_for_event);static auto pending=real<decltype(&xcb_poll_for_event)>("xcb_poll_for_event");
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
  ORIGINAL(name);if(configured&&(static_cast<unsigned char>(bytes[0])&127)==XCB_SELECTION_NOTIFY){xcb_selection_notify_event_t event{};std::memcpy(&event,bytes,sizeof(event));Transfer transfer; \
    if(event.property&&lookup(connection,event.requestor,event.property,transfer)&&transfer.copy){ \
      if(holdNotification(connection,true,event.requestor,event.property,atoms(connection,true),transfer))return xcb_no_operation_checked(connection); \
      if((transfer.denied&&active(current()))||!direction(true,current())){std::array<char,32> denied{};std::memcpy(denied.data(),bytes,32);reinterpret_cast<xcb_selection_notify_event_t*>(denied.data())->property=0;return original(connection,propagate,destination,mask,denied.data());}}} \
  return original(connection,propagate,destination,mask,bytes);}
SEND(xcb_send_event)
SEND(xcb_send_event_checked)
#define DESTROY(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t window){ORIGINAL(name);forget(connection,window);return original(connection,window);}
DESTROY(xcb_destroy_window)
DESTROY(xcb_destroy_window_checked)
#define DELETE(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t window,xcb_atom_t property){ORIGINAL(name);if(configured)clearCache(connection,window,property);return original(connection,window,property);}
DELETE(xcb_delete_property)
DELETE(xcb_delete_property_checked)
extern "C" void xcb_disconnect(xcb_connection_t* connection){ORIGINAL(xcb_disconnect);forget(connection);original(connection);}
