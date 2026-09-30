#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xlib-xcb.h>
#include <xcb/xcb.h>
#include <xcb/xcbext.h>
#include <unistd.h>
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <iterator>
#include <map>
#include <array>
#include <string>
#include <thread>
#include <vector>

using Clock=std::chrono::steady_clock;
static std::string input(const char* file){std::ifstream stream(file,std::ios::binary);return {std::istreambuf_iterator<char>(stream),{}};}
static std::string hex(const void* raw,size_t length){
  const auto bytes=static_cast<const unsigned char*>(raw);std::string result;const char* digits="0123456789abcdef";
  for(size_t i=0;i<length;++i){result+=digits[bytes[i]>>4];result+=digits[bytes[i]&15];}return result;
}
struct Event {int type=0,state=0;uint32_t window=0,property=0,selection=0,target=0,time=0;};
struct Value {uint32_t type=0;int format=0;size_t count=0,after=0;std::vector<unsigned char> bytes;};
class Connection {
 public:
  Display* display=nullptr;xcb_connection_t* wire=nullptr;bool xcb=false,mixed=false;uint32_t window=0;
  explicit Connection(const std::string& toolkit):xcb(toolkit=="xcb"),mixed(toolkit=="mixed"){
    if(xcb){int index=0;wire=xcb_connect(nullptr,&index);if(xcb_connection_has_error(wire))std::exit(2);
      auto screens=xcb_setup_roots_iterator(xcb_get_setup(wire));while(index--)xcb_screen_next(&screens);
      window=xcb_generate_id(wire);uint32_t mask=XCB_EVENT_MASK_PROPERTY_CHANGE;
      xcb_create_window(wire,XCB_COPY_FROM_PARENT,window,screens.data->root,0,0,1,1,0,XCB_WINDOW_CLASS_INPUT_OUTPUT,screens.data->root_visual,XCB_CW_EVENT_MASK,&mask);
    }else{display=XOpenDisplay(nullptr);if(!display)std::exit(2);wire=XGetXCBConnection(display);
      window=XCreateSimpleWindow(display,DefaultRootWindow(display),0,0,1,1,0,0,0);XSelectInput(display,window,PropertyChangeMask);
    }
  }
  ~Connection(){if(display)XCloseDisplay(display);else xcb_disconnect(wire);}
  uint32_t atom(const char* name){if(display)return XInternAtom(display,name,False);
    auto reply=xcb_intern_atom_reply(wire,xcb_intern_atom(wire,0,std::strlen(name),name),nullptr);if(!reply)return 0;const auto value=reply->atom;free(reply);return value;
  }
  std::string name(uint32_t atom){if(display){char* value=XGetAtomName(display,atom);std::string result=value?value:"";if(value)XFree(value);return result;}
    auto value=xcb_get_atom_name_reply(wire,xcb_get_atom_name(wire,atom),nullptr);if(!value)return {};std::string result(xcb_get_atom_name_name(value),xcb_get_atom_name_name_length(value));free(value);return result;
  }
  void flush(){if(display)XFlush(display);else xcb_flush(wire);}
  void select(uint32_t destination){if(display&&!mixed)XSelectInput(display,destination,PropertyChangeMask);
    else{uint32_t mask=XCB_EVENT_MASK_PROPERTY_CHANGE;xcb_change_window_attributes(wire,destination,XCB_CW_EVENT_MASK,&mask);}flush();
  }
  void change(uint32_t destination,uint32_t property,uint32_t type,int format,const void* bytes,size_t count,int mode=PropModeReplace){
    if(display&&!mixed){std::vector<unsigned long> longs;if(format==32){longs.resize(count);for(size_t i=0;i<count;++i){uint32_t value=0;std::memcpy(&value,static_cast<const unsigned char*>(bytes)+i*4,4);longs[i]=value;}bytes=longs.data();}
      XChangeProperty(display,destination,property,type,format,mode,static_cast<const unsigned char*>(bytes),count);
    }else{auto error=xcb_request_check(wire,xcb_change_property_checked(wire,mode,destination,property,type,format,count,bytes));if(error){std::cerr<<"property error "<<int(error->error_code)<<std::endl;free(error);std::exit(4);}}
    flush();
  }
  void remove(uint32_t property){if(display)XDeleteProperty(display,window,property);else xcb_delete_property(wire,window,property);flush();}
  bool own(uint32_t selection){if(display){XSetSelectionOwner(display,selection,window,CurrentTime);flush();return XGetSelectionOwner(display,selection)==window;}
    free(xcb_request_check(wire,xcb_set_selection_owner_checked(wire,window,selection,XCB_CURRENT_TIME)));auto result=xcb_get_selection_owner_reply(wire,xcb_get_selection_owner(wire,selection),nullptr);const bool owned=result&&result->owner==window;free(result);return owned;
  }
  void convert(uint32_t selection,uint32_t target,uint32_t property){if(display&&!mixed)XConvertSelection(display,selection,target,property,window,CurrentTime);else xcb_convert_selection_checked(wire,window,selection,target,property,XCB_CURRENT_TIME);flush();}
  void notify(const Event& request,uint32_t property){if(display){XEvent response{};response.xselection={SelectionNotify,0,True,display,request.window,request.selection,request.target,property,request.time};XSendEvent(display,request.window,False,0,&response);}
    else{xcb_selection_notify_event_t response{};response.response_type=XCB_SELECTION_NOTIFY;response.requestor=request.window;response.selection=request.selection;response.target=request.target;response.property=property;response.time=request.time;char bytes[32]{};std::memcpy(bytes,&response,sizeof(response));xcb_send_event(wire,0,request.window,0,bytes);}flush();
  }
  bool event(Event& value,bool wait=false){
    if(display){if(!wait&&!XPending(display))return false;XEvent raw{};XNextEvent(display,&raw);value.type=raw.type;
      if(raw.type==SelectionRequest){auto& r=raw.xselectionrequest;value.window=r.requestor;value.property=r.property;value.selection=r.selection;value.target=r.target;value.time=r.time;}
      if(raw.type==SelectionNotify)value.property=raw.xselection.property;
      if(raw.type==PropertyNotify){value.window=raw.xproperty.window;value.property=raw.xproperty.atom;value.state=raw.xproperty.state;}
    }else{auto raw=wait?xcb_wait_for_event(wire):xcb_poll_for_event(wire);if(!raw)return false;value.type=raw->response_type&127;
      if(value.type==XCB_SELECTION_REQUEST){auto& r=*reinterpret_cast<xcb_selection_request_event_t*>(raw);value.window=r.requestor;value.property=r.property;value.selection=r.selection;value.target=r.target;value.time=r.time;}
      if(value.type==XCB_SELECTION_NOTIFY)value.property=reinterpret_cast<xcb_selection_notify_event_t*>(raw)->property;
      if(value.type==XCB_PROPERTY_NOTIFY){auto& r=*reinterpret_cast<xcb_property_notify_event_t*>(raw);value.window=r.window;value.property=r.atom;value.state=r.state;}free(raw);
    }return true;
  }
  Value get(uint32_t property,long offset,long length,bool remove,const std::string& action,bool useXcb=false){
    Value value;if(display&&!useXcb){Atom type=0;unsigned long count=0,after=0;unsigned char* bytes=nullptr;
      XGetWindowProperty(display,window,property,offset,length,remove,AnyPropertyType,&type,&value.format,&count,&after,&bytes);value.type=type;value.count=count;value.after=after;
      if(bytes&&value.format==32){value.bytes.resize(count*4);for(size_t i=0;i<count;++i){uint32_t item=reinterpret_cast<unsigned long*>(bytes)[i];std::memcpy(value.bytes.data()+i*4,&item,4);}}
      else if(bytes&&value.format)value.bytes.assign(bytes,bytes+count*(value.format/8));if(bytes)XFree(bytes);
    }else{auto cookie=xcb_get_property_unchecked(wire,remove,window,property,XCB_GET_PROPERTY_TYPE_ANY,offset,length);xcb_get_property_reply_t* reply=nullptr;
      if(action=="wait"||action=="wait64")reply=static_cast<xcb_get_property_reply_t*>(action=="wait"?xcb_wait_for_reply(wire,cookie.sequence,nullptr):xcb_wait_for_reply64(wire,cookie.sequence,nullptr));
      else if(action=="poll"||action=="poll64"){xcb_flush(wire);void* raw=nullptr;for(unsigned i=0;i<15000;++i){if(action=="poll"?xcb_poll_for_reply(wire,cookie.sequence,&raw,nullptr):xcb_poll_for_reply64(wire,cookie.sequence,&raw,nullptr))break;usleep(1000);}reply=static_cast<xcb_get_property_reply_t*>(raw);}
      else reply=xcb_get_property_reply(wire,cookie,nullptr);
      if(reply){value.type=reply->type;value.format=reply->format;value.count=reply->value_len;value.after=reply->bytes_after;const auto bytes=static_cast<unsigned char*>(xcb_get_property_value(reply));value.bytes.assign(bytes,bytes+xcb_get_property_value_length(reply));}free(reply);
    }return value;
  }
};
static int owner(Connection& connection,int argc,char** argv,uint32_t selection,uint32_t target,uint32_t targets,uint32_t timestamp){
  auto data=input(argv[4]);std::string mode=argc>6?argv[6]:"ordinary";const bool incremental=mode.rfind("incr",0)==0;
  const auto first=mode.find(':'),second=first==std::string::npos?first:mode.find(':',first+1);
  const size_t chunk=first==std::string::npos?65536:std::max(1, std::atoi(mode.c_str()+first+1));const unsigned delay=second==std::string::npos?0:std::atoi(mode.c_str()+second+1);
  const auto variant=mode.substr(0,first);const auto incr=connection.atom("INCR");
  if(variant=="incr-targets"){target=targets;std::vector<uint32_t> values{connection.atom("UTF8_STRING"),targets,timestamp,connection.atom("image/png"),connection.atom("text/uri-list"),connection.atom("MULTIPLE"),incr};data.assign(reinterpret_cast<const char*>(values.data()),values.size()*4);}
  struct Pending {size_t position=0,chunks=0;};std::map<std::pair<uint32_t,uint32_t>,Pending> pending;
  const auto ready=connection.own(selection)?"READY":"REFUSED";std::cout<<ready<<std::endl;if(argc>7)std::ofstream(argv[7])<<ready;
  for(;;){Event event;if(!connection.event(event,true))return 3;
    if(event.type==PropertyNotify&&event.state==PropertyDelete){const auto key=std::make_pair(event.window,event.property);auto found=pending.find(key);if(found==pending.end())continue;
      auto& stream=found->second;if(variant=="incr-stall"&&stream.chunks)continue;
      if(variant=="incr-no-terminal"&&stream.position==data.size())continue;
      if(delay)usleep(delay*1000);
      const size_t length=std::min(chunk,data.size()-stream.position);auto type=variant=="incr-targets"?uint32_t(XA_ATOM):target;int format=variant=="incr32"||variant=="incr-targets"?32:8;
      if(variant=="incr-bad-type"&&stream.chunks)type=XA_STRING;
      if(variant=="incr-bad-format"&&stream.chunks)format=16;
      const auto units=length/(format/8);connection.change(event.window,event.property,type,format,data.data()+stream.position,units,PropModeAppend);stream.position+=length;++stream.chunks;
      if(variant=="incr-pause"&&stream.chunks==1){std::cout<<"CHUNK"<<std::endl;std::string line;std::getline(std::cin,line);}
      if(!length)pending.erase(found);continue;
    }
    if(event.type!=SelectionRequest)continue;const uint32_t property=event.property?event.property:event.target;bool accepted=true;
    if(event.target==targets&&variant!="incr-targets"){std::vector<uint32_t> values{target,targets,timestamp,connection.atom("image/png"),connection.atom("text/uri-list"),connection.atom("MULTIPLE"),incr};connection.change(event.window,property,XA_ATOM,32,values.data(),values.size());}
    else if(event.target==timestamp){uint32_t value=0;connection.change(event.window,property,XA_INTEGER,32,&value,1);}
    else if(event.target==target){if(incremental){connection.select(event.window);uint32_t hint=data.size();if(variant=="incr-underhint"||variant=="incr-no-terminal")hint=0;if(variant=="incr-hint")++hint;if(variant=="incr-overhint")hint=1048577;
        pending[{event.window,property}]={};connection.change(event.window,property,incr,variant=="incr-bad-header"?8:32,&hint,1);
      }else connection.change(event.window,property,target,8,data.data(),data.size());
    }else accepted=false;
    connection.notify(event,accepted?property:0);
  }
}
int main(int argc,char** argv){
  XInitThreads();
  if(argc<4)return 1;const std::string toolkit=argv[1],action=argv[2];Connection connection(toolkit);
  const auto selection=connection.atom(argc>5?argv[5]:"CLIPBOARD"),target=connection.atom(argv[3]);
  const auto property=connection.atom("SAKURA_FIXTURE_SELECTION"),targets=connection.atom("TARGETS"),timestamp=connection.atom("TIMESTAMP"),incr=connection.atom("INCR");
  if(action=="owner")return owner(connection,argc,argv,selection,target,targets,timestamp);
  if(action=="maximum"){std::cout<<xcb_get_maximum_request_length(connection.wire)*4ull<<std::endl;return 0;}
  auto print=[&](const std::string& result){std::cout<<result<<std::endl;if(action=="probe"){std::ofstream(argv[4])<<result;for(;;)usleep(1000000);}};
  if(action=="stress"){size_t accepted=0,refused=0;
    for(unsigned i=0;i<48;++i){const auto unique=connection.atom(("SAKURA_FIXTURE_STRESS_"+std::to_string(i)).c_str());connection.convert(selection,target,unique);Event next;bool ready=false;const auto until=Clock::now()+std::chrono::seconds(12);
      while(!ready&&Clock::now()<until){while(connection.event(next))if(next.type==SelectionNotify){ready=true;break;}if(!ready)usleep(1000);}
      if(!ready||!next.property){++refused;continue;}auto value=connection.get(unique,0,1024*1024,false,action,connection.mixed);if(value.type&&value.type!=incr)++accepted;else ++refused;
    }print(std::to_string(accepted)+"/"+std::to_string(refused));return 0;
  }
  connection.convert(selection,target,property);Event event;bool ready=false;const auto deadline=Clock::now()+std::chrono::seconds(12);
  while(!ready&&Clock::now()<deadline){while(connection.event(event)){if(event.type==SelectionNotify){ready=true;break;}}if(!ready)usleep(1000);}
  if(!ready||!event.property){print("DENIED");return ready?0:3;}
  if(action=="concurrent"){
    std::array<Value,4> values;std::vector<std::thread> workers;
    for(size_t i=0;i<values.size();++i)workers.emplace_back([&,i](){values[i]=connection.get(property,0,1024*1024,false,"read",connection.mixed&&i%2);});
    for(auto& worker:workers)worker.join();const auto expected=input(argv[4]);
    const bool valid=std::all_of(values.begin(),values.end(),[&](const Value& value){return value.type&&value.type!=incr&&std::string(value.bytes.begin(),value.bytes.end())==expected;});print(valid?"COMPLETE":"DENIED");return 0;
  }
  if(action=="reply-stress"){
    for(unsigned i=0;i<4096;++i)xcb_get_property_unchecked(connection.wire,0,connection.window,property,XCB_GET_PROPERTY_TYPE_ANY,0,1024);
    auto value=xcb_get_property_reply(connection.wire,xcb_get_property(connection.wire,0,connection.window,property,XCB_GET_PROPERTY_TYPE_ANY,0,1024),nullptr);
    print(value&&value->type?"EXPOSED":"DENIED");free(value);return 0;
  }
  if(action=="size"){auto probe=connection.get(property,0,0,false,action);if(!probe.type||probe.count){print("DENIED");return 0;}}
  auto read=[&](){const bool remove=action=="delete";auto value=connection.get(property,argc>6?std::strtol(argv[6],nullptr,10):0,action=="short"?1:1024*1024,remove,action,connection.mixed);
    if(value.type==incr){connection.remove(property);Value complete;const auto limit=Clock::now()+std::chrono::seconds(10);
      while(Clock::now()<limit){auto part=connection.get(property,0,1024*1024,false,action,connection.mixed);if(!part.type){usleep(1000);continue;}
        if(!complete.type){complete.type=part.type;complete.format=part.format;}
        if(part.type!=complete.type||part.format!=complete.format||part.after||complete.bytes.size()+part.bytes.size()>16*1024*1024){complete.type=0;break;}
        complete.bytes.insert(complete.bytes.end(),part.bytes.begin(),part.bytes.end());connection.remove(property);if(part.bytes.empty()){complete.count=complete.bytes.size()/(complete.format/8);value=std::move(complete);break;}
      }
    }
    if(!value.type||value.type==incr){print("DENIED");return;}
    if(target==targets&&value.format==32){std::string names;for(size_t i=0;i<value.count;++i){uint32_t atom=0;std::memcpy(&atom,value.bytes.data()+i*4,4);names+=connection.name(atom)+';';}print(names);}
    else print(value.bytes.empty()?"EMPTY":hex(value.bytes.data(),value.bytes.size()));
  };
  read();if(action=="cache"||action=="delete"){std::string line;std::getline(std::cin,line);read();}return 0;
}
