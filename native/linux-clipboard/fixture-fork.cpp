// Test-only: reuse the actual Xlib/XCB/mixed protocol helpers, without exec in
// any child. Returning from main exercises ordinary C++ local/static cleanup.
#define main sakura_protocol_fixture_main
#include "fixture.cpp"
#undef main
#include <sys/wait.h>

static bool boundedForks(unsigned remaining){
  const auto pid=fork();if(pid<0)return false;
  if(!pid){if(remaining==1){Connection overflow("xcb");return false;}std::exit(boundedForks(remaining-1)?0:22);}
  int status=0;return waitpid(pid,&status,0)==pid&&WIFEXITED(status)&&WEXITSTATUS(status)==(remaining==1?126:0);
}

struct MultipleRequest {
  uint32_t parent=0;
  std::vector<uint32_t> pairs;
  explicit MultipleRequest(Connection& connection,unsigned count=2){
    parent=connection.atom("SAKURA_FORK_PARENT");
    for(unsigned i=0;i<count;++i){pairs.push_back(connection.atom(i%2?"text/plain":"UTF8_STRING"));pairs.push_back(connection.atom(("SAKURA_FORK_DATA_"+std::to_string(i)).c_str()));}
  }
  void begin(Connection& connection,uint32_t selection){
    connection.change(connection.window,parent,connection.atom("ATOM_PAIR"),32,pairs.data(),pairs.size());
    connection.convert(selection,connection.atom("MULTIPLE"),parent);
  }
  bool finish(Connection& connection,const std::string& expected){
    Event event;bool notified=false;unsigned notifications=0;const auto until=Clock::now()+std::chrono::seconds(15);
    while(!notified&&Clock::now()<until){while(connection.event(event))if(event.type==SelectionNotify){notified=true;++notifications;break;}if(!notified)usleep(1000);}
    if(!notified||event.property!=parent)return false;
    auto list=connection.get(parent,0,1024,false,"wait64",connection.mixed);
    if(list.format!=32||list.count!=pairs.size()||list.after||list.bytes.size()!=pairs.size()*4||std::memcmp(list.bytes.data(),pairs.data(),list.bytes.size()))return false;
    for(unsigned i=0;i<pairs.size()/2;++i){auto body=connection.get(pairs[i*2+1],0,1048576,false,i?"poll64":"wait",connection.mixed);
      if(!body.type||body.format!=8||body.after||std::string(body.bytes.begin(),body.bytes.end())!=expected)return false;}
    while(connection.event(event))if(event.type==SelectionNotify)++notifications;
    return notifications==1;
  }
  bool denied(Connection& connection){
    for(unsigned i=0;i<pairs.size()/2;++i){auto body=connection.get(pairs[i*2+1],0,1048576,false,"poll64",connection.mixed);
      if(body.type||body.count||body.after||!body.bytes.empty())return false;}return true;
  }
};

int main(int argc,char** argv){
  XInitThreads();if(argc<7)return 1;
  const std::string toolkit=argv[1],action=argv[2],parentText=input(argv[4]),childText=input(argv[6]);
  Connection parent(toolkit);MultipleRequest pending(parent);const auto selection=parent.atom("CLIPBOARD");
  pending.begin(parent,selection);std::cout<<"STARTED"<<std::endl;
  std::string command;std::getline(std::cin,command);
  const auto pid=fork();if(pid<0)return 10;
  if(!pid){
    if(action=="fork-depth"){if(!boundedForks(32))return 21;std::cout<<"DEPTH-BOUND-DENIED"<<std::endl;return 0;}
    if(action=="fork-inherited"){
      auto body=parent.get(pending.pairs[1],0,1048576,false,"wait64",parent.mixed);(void)body;
      return 11;
    }
    if(action=="fork-inherited-fd"){
      auto wire=xcb_connect_to_fd(xcb_get_file_descriptor(parent.wire),nullptr);xcb_disconnect(wire);return 11;
    }
    if(action!="fork-idle-exit"){
      Connection child(toolkit);
      if(action=="fork-live"){setenv("DISPLAY",":19999",1);setenv("XAUTHORITY","/unavailable-authority",1);}
      MultipleRequest request(child,32);request.begin(child,child.atom("PRIMARY"));
      if(!request.finish(child,childText))return 12;
      if(action=="fork-nested"){
        const auto nested=fork();if(nested<0)return 18;
        if(!nested){Connection grandchild(toolkit);MultipleRequest again(grandchild,32);again.begin(grandchild,grandchild.atom("PRIMARY"));
          if(!again.finish(grandchild,childText))return 19;std::cout<<"GRANDCHILD-COMPLETE"<<std::endl;return 0;}
        int result=0;if(waitpid(nested,&result,0)!=nested||!WIFEXITED(result)||WEXITSTATUS(result))return 20;
        std::cout<<"GRANDCHILD-EXIT-0"<<std::endl;
      }
      std::cout<<"CHILD-COMPLETE"<<std::endl;
      std::getline(std::cin,command);
      if(!request.denied(child))return 13;std::cout<<"CHILD-RECHECK-DENIED"<<std::endl;
      // Close the inherited application's aliases too. These cleanup hooks must
      // not send X11 requests or close/shutdown a descriptor shared with parent.
      if(parent.display)XCloseDisplay(parent.display);
      xcb_disconnect(parent.wire);
    }
    return 0;
  }
  int status=0;if(waitpid(pid,&status,0)!=pid||!WIFEXITED(status))return 14;
  const int expected=action=="fork-inherited"||action=="fork-inherited-fd"?126:0;
  if(WEXITSTATUS(status)!=expected){std::cerr<<"child exit "<<WEXITSTATUS(status)<<std::endl;return 15;}
  std::cout<<(expected?"CHILD-REJECTED-126":"CHILD-EXIT-0")<<std::endl;
  if(!pending.finish(parent,parentText))return 16;std::cout<<"PARENT-COMPLETE"<<std::endl;
  std::getline(std::cin,command);pending.begin(parent,selection);std::cout<<"PARENT-NEXT"<<std::endl;
  if(!pending.finish(parent,parentText))return 17;std::cout<<"PARENT-NEXT-COMPLETE"<<std::endl;
  return 0;
}
