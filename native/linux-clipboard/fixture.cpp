#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xlib-xcb.h>
#include <xcb/xcb.h>
#include <xcb/xcbext.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

static void denied(int argc,char** argv){
  std::cout<<"DENIED"<<std::endl;
  if(argc>4&&std::string(argv[2])=="probe"){std::ofstream(argv[4])<<"DENIED";for(;;)usleep(1000000);}
}

static std::string hex(const void* raw,size_t length){
  const auto bytes=static_cast<const unsigned char*>(raw);std::string result;const char* digits="0123456789abcdef";
  for(size_t i=0;i<length;++i){result+=digits[bytes[i]>>4];result+=digits[bytes[i]&15];}return result;
}
static std::string input(const char* file){std::ifstream stream(file,std::ios::binary);return {std::istreambuf_iterator<char>(stream),{}};}
static int xlib(int argc,char** argv){
  Display* display=XOpenDisplay(nullptr);if(!display)return 2;
  Window window=XCreateSimpleWindow(display,DefaultRootWindow(display),0,0,1,1,0,0,0);
  Atom selection=XInternAtom(display,argc>5?argv[5]:"CLIPBOARD",False),target=XInternAtom(display,argv[3],False);
  Atom property=XInternAtom(display,"SAKURA_FIXTURE_SELECTION",False),targets=XInternAtom(display,"TARGETS",False),timestamp=XInternAtom(display,"TIMESTAMP",False);
  if(std::string(argv[2])=="owner") {
    std::string data=input(argv[4]);XSetSelectionOwner(display,selection,window,CurrentTime);XFlush(display);
    const auto ready=XGetSelectionOwner(display,selection)==window?"READY":"REFUSED";
    std::cout<<ready<<std::endl;
    if(argc>7)std::ofstream(argv[7])<<ready;
    for(;;){XEvent event{};XNextEvent(display,&event);if(event.type!=SelectionRequest)continue;
      const auto& request=event.xselectionrequest;Atom destination=request.property?request.property:request.target;bool success=true;
      if(request.target==targets){std::vector<Atom> values{target,targets,timestamp,XInternAtom(display,"image/png",False),XInternAtom(display,"text/uri-list",False),XInternAtom(display,"MULTIPLE",False),XInternAtom(display,"INCR",False)};
        XChangeProperty(display,request.requestor,destination,XA_ATOM,32,PropModeReplace,reinterpret_cast<unsigned char*>(values.data()),values.size());
      } else if(request.target==timestamp){unsigned long value=0;XChangeProperty(display,request.requestor,destination,XA_INTEGER,32,PropModeReplace,reinterpret_cast<unsigned char*>(&value),1);
      } else if(request.target==target){Atom type=target;int format=8;const void* bytes=data.data();size_t length=data.size();unsigned long value=data.size();
        if(argc>6&&std::string(argv[6])=="incr"){type=XInternAtom(display,"INCR",False);format=32;bytes=&value;length=1;}
        if(std::string(argv[1])=="mixed"){
          uint32_t small=value;const void* wire=format==32?&small:bytes;
          xcb_change_property(XGetXCBConnection(display),XCB_PROP_MODE_REPLACE,request.requestor,destination,type,format,length,wire);
        }else XChangeProperty(display,request.requestor,destination,type,format,PropModeReplace,static_cast<const unsigned char*>(bytes),length);
      } else success=false;
      XEvent response{};response.xselection={SelectionNotify,0,True,display,request.requestor,request.selection,request.target,success?destination:None,request.time};
      XSendEvent(display,request.requestor,False,0,&response);XFlush(display);
    }
  }
  if(std::string(argv[1])=="mixed")xcb_convert_selection(XGetXCBConnection(display),window,selection,target,property,CurrentTime);
  else XConvertSelection(display,selection,target,property,window,CurrentTime);
  XFlush(display);
  XEvent event{};bool ready=false;
  for(unsigned i=0;i<5000&&!ready;++i){while(XPending(display)){XNextEvent(display,&event);if(event.type==SelectionNotify){ready=true;break;}}if(!ready)usleep(1000);}
  if(!ready||event.xselection.property==None){denied(argc,argv);XCloseDisplay(display);return ready?0:3;}
  if(std::string(argv[2])=="size"){
    Atom type=0;int format=0;unsigned long count=0,after=0;unsigned char* bytes=nullptr;
    XGetWindowProperty(display,window,property,0,0,False,AnyPropertyType,&type,&format,&count,&after,&bytes);
    if(bytes)XFree(bytes);
    if(!type||count){denied(argc,argv);XCloseDisplay(display);return 0;}
  }
  auto read=[&](){Atom type=0;int format=0;unsigned long count=0,after=0;unsigned char* bytes=nullptr;
    XGetWindowProperty(display,window,property,argc>6?std::strtol(argv[6],nullptr,10):0,1024*1024,False,AnyPropertyType,&type,&format,&count,&after,&bytes);
    if(!type)denied(argc,argv);
    else if(target==targets&&format==32){auto values=reinterpret_cast<Atom*>(bytes);for(size_t i=0;i<count;++i){char* name=XGetAtomName(display,values[i]);if(name){std::cout<<name<<';';XFree(name);}}std::cout<<std::endl;}
    else {auto value=hex(bytes,count*(format/8));std::cout<<value<<std::endl;if(std::string(argv[2])=="probe")std::ofstream(argv[4])<<value;}
    if(bytes)XFree(bytes);
  };
  read();if(std::string(argv[2])=="cache"){std::string line;std::getline(std::cin,line);read();}
  if(std::string(argv[2])=="probe")for(;;)usleep(1000000);
  XCloseDisplay(display);return 0;
}
static xcb_atom_t atom(xcb_connection_t* connection,const char* name){auto reply=xcb_intern_atom_reply(connection,xcb_intern_atom(connection,0,std::strlen(name),name),nullptr);if(!reply)return 0;auto result=reply->atom;free(reply);return result;}
static int xcb(int argc,char** argv){
  int screenIndex=0;xcb_connection_t* connection=xcb_connect(nullptr,&screenIndex);if(xcb_connection_has_error(connection))return 2;
  auto screens=xcb_setup_roots_iterator(xcb_get_setup(connection));while(screenIndex--)xcb_screen_next(&screens);
  const auto window=xcb_generate_id(connection);xcb_create_window(connection,XCB_COPY_FROM_PARENT,window,screens.data->root,0,0,1,1,0,XCB_WINDOW_CLASS_INPUT_OUTPUT,screens.data->root_visual,0,nullptr);
  const auto selection=atom(connection,argc>5?argv[5]:"CLIPBOARD"),target=atom(connection,argv[3]);
  const auto property=atom(connection,"SAKURA_FIXTURE_SELECTION"),targets=atom(connection,"TARGETS"),timestamp=atom(connection,"TIMESTAMP");
  if(std::string(argv[2])=="owner") {
    const auto data=input(argv[4]);auto error=xcb_request_check(connection,xcb_set_selection_owner_checked(connection,window,selection,XCB_CURRENT_TIME));free(error);
    auto owner=xcb_get_selection_owner_reply(connection,xcb_get_selection_owner(connection,selection),nullptr);
    const auto ready=owner&&owner->owner==window?"READY":"REFUSED";
    std::cout<<ready<<std::endl;free(owner);
    if(argc>7)std::ofstream(argv[7])<<ready;
    for(;;){auto raw=xcb_wait_for_event(connection);if(!raw)return 3;
      if((raw->response_type&127)==XCB_SELECTION_REQUEST){const auto request=*reinterpret_cast<xcb_selection_request_event_t*>(raw);const auto destination=request.property?request.property:request.target;bool success=true;
        if(request.target==targets){std::vector<uint32_t> values{target,targets,timestamp,atom(connection,"image/png"),atom(connection,"text/uri-list"),atom(connection,"MULTIPLE"),atom(connection,"INCR")};
          auto check=xcb_request_check(connection,xcb_change_property_checked(connection,XCB_PROP_MODE_REPLACE,request.requestor,destination,XCB_ATOM_ATOM,32,values.size(),values.data()));free(check);
        }else if(request.target==timestamp){uint32_t value=0;xcb_change_property(connection,XCB_PROP_MODE_REPLACE,request.requestor,destination,XCB_ATOM_INTEGER,32,1,&value);
        }else if(request.target==target){auto type=target;uint8_t format=8;const void* bytes=data.data();size_t length=data.size();uint32_t value=data.size();
          if(argc>6&&std::string(argv[6])=="incr"){type=atom(connection,"INCR");format=32;bytes=&value;length=1;}
          auto check=xcb_request_check(connection,xcb_change_property_checked(connection,XCB_PROP_MODE_REPLACE,request.requestor,destination,type,format,length,bytes));free(check);
        }else success=false;
        xcb_selection_notify_event_t response{};response.response_type=XCB_SELECTION_NOTIFY;response.requestor=request.requestor;response.selection=request.selection;response.target=request.target;response.property=success?destination:0;response.time=request.time;
        char bytes[32]{};std::memcpy(bytes,&response,sizeof(response));xcb_send_event(connection,0,request.requestor,0,bytes);xcb_flush(connection);
      }free(raw);
    }
  }
  xcb_convert_selection_checked(connection,window,selection,target,property,XCB_CURRENT_TIME);xcb_flush(connection);
  xcb_selection_notify_event_t notify{};bool ready=false;
  for(unsigned i=0;i<5000&&!ready;++i){while(auto raw=xcb_poll_for_event(connection)){if((raw->response_type&127)==XCB_SELECTION_NOTIFY){notify=*reinterpret_cast<xcb_selection_notify_event_t*>(raw);ready=true;}free(raw);if(ready)break;}if(!ready)usleep(1000);}
  if(!ready||!notify.property){denied(argc,argv);xcb_disconnect(connection);return ready?0:3;}
  if(std::string(argv[2])=="size"){
    auto probe=xcb_get_property_reply(connection,xcb_get_property(connection,0,window,property,XCB_GET_PROPERTY_TYPE_ANY,0,0),nullptr);
    const bool valid=probe&&probe->type&&probe->value_len==0;free(probe);
    if(!valid){denied(argc,argv);xcb_disconnect(connection);return 0;}
  }
  auto read=[&](){const auto cookie=xcb_get_property_unchecked(connection,0,window,property,XCB_GET_PROPERTY_TYPE_ANY,argc>6?std::strtol(argv[6],nullptr,10):0,1024*1024);
    xcb_get_property_reply_t* reply=nullptr;
    if(std::string(argv[2])=="wait")reply=static_cast<xcb_get_property_reply_t*>(xcb_wait_for_reply64(connection,cookie.sequence,nullptr));
    else if(std::string(argv[2])=="poll"){xcb_flush(connection);void* value=nullptr;for(unsigned i=0;i<5000&&!xcb_poll_for_reply(connection,cookie.sequence,&value,nullptr);++i)usleep(1000);reply=static_cast<xcb_get_property_reply_t*>(value);}
    else reply=xcb_get_property_reply(connection,cookie,nullptr);
    if(!reply||!reply->type)denied(argc,argv);
    else if(target==targets&&reply->format==32){const auto values=static_cast<uint32_t*>(xcb_get_property_value(reply));for(size_t i=0;i<reply->value_len;++i){auto name=xcb_get_atom_name_reply(connection,xcb_get_atom_name(connection,values[i]),nullptr);if(name){std::cout<<std::string(xcb_get_atom_name_name(name),xcb_get_atom_name_name_length(name))<<';';free(name);}}std::cout<<std::endl;}
    else {auto value=hex(xcb_get_property_value(reply),xcb_get_property_value_length(reply));std::cout<<value<<std::endl;if(std::string(argv[2])=="probe")std::ofstream(argv[4])<<value;}
    free(reply);
  };
  read();if(std::string(argv[2])=="cache"){std::string line;std::getline(std::cin,line);read();}
  if(std::string(argv[2])=="probe")for(;;)usleep(1000000);
  xcb_disconnect(connection);return 0;
}
int main(int argc,char** argv){if(argc<4)return 1;return std::string(argv[1])=="xcb"?xcb(argc,argv):xlib(argc,argv);}
