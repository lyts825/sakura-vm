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
#include <cstdlib>
#include <cstring>
#include <map>
#include <mutex>
#include <regex>
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
struct Transfer { bool copy=false,denied=false; uint32_t target=0; };
using Key=std::tuple<void*,uint32_t,uint32_t>;
std::map<Key,Transfer> transfers;
struct Reply {Key key;uint32_t offset,length;};
std::map<std::pair<void*,uint64_t>,Reply> replies;
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
  transfers[key]=value;if(other)transfers[alias]=value;return true;
}
bool lookup(void* connection,uint32_t window,uint32_t property,Transfer& value) {
  std::lock_guard lock(mutex);
  auto found=transfers.find({connection,window,property});
  if(found==transfers.end())return false;
  value=found->second;return true;
}
void deny(void* connection,uint32_t window,uint32_t property) {
  std::lock_guard lock(mutex);
  auto found=transfers.find({connection,window,property});
  if(found!=transfers.end())found->second.denied=true;
  if(auto other=peer(connection)){found=transfers.find({other,window,property});if(found!=transfers.end())found->second.denied=true;}
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
      text.assign(static_cast<const char*>(bytes),count);
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
  if(!configured||event->type!=SelectionRequest)return true;
  const auto names=atoms(display,false);const auto& request=event->xselectionrequest;
  if(!names.selection(request.selection))return true;
  const auto rule=current();
  const bool tracked=remember(display,request.requestor,request.property?request.property:request.target,{true,false,uint32_t(request.target)});
  if(active(rule)&&(!direction(true,rule)||!names.allowed(request.target,rule)||request.selection==names.manager||!tracked)) {
    blocked(true);notify(display,request);return false;
  }
  return true;
}
bool observe(xcb_connection_t* connection,xcb_generic_event_t* event) {
  if(!configured||!event||(event->response_type&127)!=XCB_SELECTION_REQUEST)return true;
  // libX11 drains XCB events with its Display lock held. New XCB requests here
  // would reenter that lock. Xlib's event hooks handle its queue; Qt's explicit
  // XCBOwnsEventQueue still uses the XCB hooks.
  {std::lock_guard lock(mutex);auto found=xlibConnections.find(connection);
    if(found!=xlibConnections.end()&&found->second.second)return true;}
  const auto names=atoms(connection,true);const auto& request=*reinterpret_cast<xcb_selection_request_event_t*>(event);
  if(!names.selection(request.selection))return true;
  const auto rule=current();
  const bool tracked=remember(connection,request.requestor,request.property?request.property:request.target,{true,false,request.target});
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
      const bool tracked=remember(display,requestor,property?property:target,{false,false,uint32_t(target)});
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
  const int result=original(display,window,property,offset,length,remove,requested,type,format,count,after,bytes);
  Transfer transfer;
  if(configured&&lookup(display,window,property,transfer)&&!transfer.copy) {
    const auto names=atoms(display,false);const auto rule=current();
    const bool probe=active(rule)&&offset==0&&length==0&&metadataOnly(names,transfer.target,*type,*format,*count,*after,rule);
    if((active(rule)&&transfer.denied)||!direction(false,rule)||(active(rule)&&(offset!=0||(*after!=0&&!probe)))||
      (!probe&&!content(names,transfer.target,*type,*format,*bytes,*count,rule))) {
      if(*bytes)XFree(*bytes);
      *bytes=nullptr;*type=None;*format=0;*count=0;*after=0;blocked(false);
    } else if(active(rule)&&transfer.target==names.targets) {
      *count=filter(names,reinterpret_cast<Atom*>(*bytes),*count,rule);
    }
  }
  return result;
}
extern "C" int XSendEvent(Display* display,Window window,Bool propagate,long mask,XEvent* event) {
  ORIGINAL(XSendEvent);
  if(configured&&event->type==SelectionNotify&&event->xselection.property) {
    Transfer transfer;
    if(lookup(display,event->xselection.requestor,event->xselection.property,transfer)&&transfer.copy&&
      ((transfer.denied&&active(current()))||!direction(true,current()))) {
      XEvent denied=*event;denied.xselection.property=None;return original(display,window,propagate,mask,&denied);
    }
  }
  return original(display,window,propagate,mask,event);
}
#define EVENT_WAIT(name,signature,arguments) extern "C" int name signature {ORIGINAL(name);int result;do{result=original arguments;}while(!observe(display,event));return result;}
EVENT_WAIT(XNextEvent,(Display* display,XEvent* event),(display,event))
EVENT_WAIT(XWindowEvent,(Display* display,Window window,long mask,XEvent* event),(display,window,mask,event))
EVENT_WAIT(XMaskEvent,(Display* display,long mask,XEvent* event),(display,mask,event))
EVENT_WAIT(XIfEvent,(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value),(display,event,predicate,value))
#define EVENT_CHECK(name,signature,arguments) extern "C" Bool name signature {ORIGINAL(name);while(original arguments){if(observe(display,event))return True;}return False;}
EVENT_CHECK(XCheckWindowEvent,(Display* display,Window window,long mask,XEvent* event),(display,window,mask,event))
EVENT_CHECK(XCheckMaskEvent,(Display* display,long mask,XEvent* event),(display,mask,event))
EVENT_CHECK(XCheckTypedEvent,(Display* display,int type,XEvent* event),(display,type,event))
EVENT_CHECK(XCheckTypedWindowEvent,(Display* display,Window window,int type,XEvent* event),(display,window,type,event))
EVENT_CHECK(XCheckIfEvent,(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value),(display,event,predicate,value))
extern "C" int XPeekEvent(Display* display,XEvent* event) {
  ORIGINAL(XPeekEvent);static auto next=real<decltype(&XNextEvent)>("XNextEvent");
  for(;;){int result=original(display,event);if(observe(display,event))return result;next(display,event);}
}
extern "C" int XPeekIfEvent(Display* display,XEvent* event,Bool(*predicate)(Display*,XEvent*,XPointer),XPointer value) {
  ORIGINAL(XPeekIfEvent);static auto next=real<decltype(&XIfEvent)>("XIfEvent");
  for(;;){int result=original(display,event,predicate,value);if(observe(display,event))return result;next(display,event,predicate,value);}
}
extern "C" int XDestroyWindow(Display* display,Window window){ORIGINAL(XDestroyWindow);forget(display,window);return original(display,window);}
extern "C" int XCloseDisplay(Display* display){ORIGINAL(XCloseDisplay);forget(display);return original(display);}

#define SET_OWNER(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t owner,xcb_atom_t selection,xcb_timestamp_t time) { \
  ORIGINAL(name);if(configured&&atoms(connection,true).selection(selection)&&!direction(true,current())){blocked(true);return xcb_no_operation_checked(connection);} \
  return original(connection,owner,selection,time);}
SET_OWNER(xcb_set_selection_owner)
SET_OWNER(xcb_set_selection_owner_checked)
#define CONVERT(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t requestor,xcb_atom_t selection,xcb_atom_t target,xcb_atom_t property,xcb_timestamp_t time) { \
  ORIGINAL(name);if(configured){const auto names=atoms(connection,true);if(names.selection(selection)){const auto rule=current(); \
    const bool tracked=remember(connection,requestor,property?property:target,{false,false,target});if(active(rule)&&(!direction(false,rule)||!names.allowed(target,rule)||selection==names.manager||!tracked)){ \
      blocked(false);xcb_selection_request_event_t request{};request.requestor=requestor;request.selection=selection;request.target=target;request.time=time;notify(connection,request);return xcb_no_operation_checked(connection);}}} \
  return original(connection,requestor,selection,target,property,time);}
CONVERT(xcb_convert_selection)
CONVERT(xcb_convert_selection_checked)
#define CHANGE(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,uint8_t mode,xcb_window_t window,xcb_atom_t property,xcb_atom_t type,uint8_t format,uint32_t length,const void* data){ \
  ORIGINAL(name);Transfer transfer;if(configured&&lookup(connection,window,property,transfer)&&transfer.copy){const auto names=atoms(connection,true);const auto rule=current(); \
    if((active(rule)&&transfer.denied)||!direction(true,rule)||(active(rule)&&mode!=XCB_PROP_MODE_REPLACE)||!content(names,transfer.target,type,format,data,length,rule)){blocked(true);deny(connection,window,property);return xcb_no_operation_checked(connection);} \
    if(active(rule)&&transfer.target==names.targets){std::vector<uint32_t> values(static_cast<const uint32_t*>(data),static_cast<const uint32_t*>(data)+length); \
      const auto count=filter(names,values.data(),values.size(),rule);return original(connection,mode,window,property,type,format,count,values.data());}} \
  return original(connection,mode,window,property,type,format,length,data);}
CHANGE(xcb_change_property)
CHANGE(xcb_change_property_checked)
#define GET(name) extern "C" xcb_get_property_cookie_t name(xcb_connection_t* connection,uint8_t remove,xcb_window_t window,xcb_atom_t property,xcb_atom_t type,uint32_t offset,uint32_t length){ \
  ORIGINAL(name);Transfer transfer;const bool tracked=configured&&lookup(connection,window,property,transfer)&&!transfer.copy; \
  if(tracked){std::lock_guard lock(mutex);if(replies.size()>=4096){blocked(false);return original(connection,remove,window,property,type,0,0);}} \
  const auto result=original(connection,remove,window,property,type,offset,length); \
  if(tracked){std::lock_guard lock(mutex);replies[{connection,result.sequence}]={{connection,window,property},offset,length};} \
  return result;}
GET(xcb_get_property)
GET(xcb_get_property_unchecked)
static void inspectReply(xcb_connection_t* connection,uint64_t sequence,void* raw) {
  if(!configured||!raw)return;
  Key key;uint32_t offset,length;{std::lock_guard lock(mutex);auto found=replies.find({connection,sequence&0xffffffff});if(found==replies.end())return;key=found->second.key;offset=found->second.offset;length=found->second.length;replies.erase(found);}
  Transfer transfer;if(!lookup(connection,std::get<1>(key),std::get<2>(key),transfer))return;
  auto reply=static_cast<xcb_get_property_reply_t*>(raw);
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
}
extern "C" xcb_get_property_reply_t* xcb_get_property_reply(xcb_connection_t* connection,xcb_get_property_cookie_t cookie,xcb_generic_error_t** error){
  ORIGINAL(xcb_get_property_reply);auto result=original(connection,cookie,error);inspectReply(connection,cookie.sequence,result);return result;
}
extern "C" void* xcb_wait_for_reply(xcb_connection_t* connection,unsigned int sequence,xcb_generic_error_t** error){
  ORIGINAL(xcb_wait_for_reply);auto result=original(connection,sequence,error);inspectReply(connection,sequence,result);return result;
}
extern "C" void* xcb_wait_for_reply64(xcb_connection_t* connection,uint64_t sequence,xcb_generic_error_t** error){
  ORIGINAL(xcb_wait_for_reply64);auto result=original(connection,sequence,error);inspectReply(connection,sequence,result);return result;
}
#define POLL_REPLY(name,sequenceType) extern "C" int name(xcb_connection_t* connection,sequenceType sequence,void** reply,xcb_generic_error_t** error){ \
  ORIGINAL(name);int result=original(connection,sequence,reply,error);if(result)inspectReply(connection,sequence,*reply);return result;}
POLL_REPLY(xcb_poll_for_reply,unsigned int)
POLL_REPLY(xcb_poll_for_reply64,uint64_t)
#define XCB_EVENT(name) extern "C" xcb_generic_event_t* name(xcb_connection_t* connection){ \
  ORIGINAL(name);for(;;){auto event=original(connection);if(observe(connection,event))return event;free(event);}}
XCB_EVENT(xcb_wait_for_event)
XCB_EVENT(xcb_poll_for_event)
XCB_EVENT(xcb_poll_for_queued_event)
#define SEND(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,uint8_t propagate,xcb_window_t destination,uint32_t mask,const char* bytes){ \
  ORIGINAL(name);if(configured&&(static_cast<unsigned char>(bytes[0])&127)==XCB_SELECTION_NOTIFY){xcb_selection_notify_event_t event{};std::memcpy(&event,bytes,sizeof(event));Transfer transfer; \
    if(event.property&&lookup(connection,event.requestor,event.property,transfer)&&transfer.copy&&((transfer.denied&&active(current()))||!direction(true,current()))){ \
      std::array<char,32> denied{};std::memcpy(denied.data(),bytes,32);reinterpret_cast<xcb_selection_notify_event_t*>(denied.data())->property=0;return original(connection,propagate,destination,mask,denied.data());}} \
  return original(connection,propagate,destination,mask,bytes);}
SEND(xcb_send_event)
SEND(xcb_send_event_checked)
#define DESTROY(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,xcb_window_t window){ORIGINAL(name);forget(connection,window);return original(connection,window);}
DESTROY(xcb_destroy_window)
DESTROY(xcb_destroy_window_checked)
extern "C" void xcb_disconnect(xcb_connection_t* connection){ORIGINAL(xcb_disconnect);forget(connection);original(connection);}
