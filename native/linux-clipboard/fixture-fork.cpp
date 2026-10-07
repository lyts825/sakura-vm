/**
 * 中文：复用真实 X11 协议夹具，在无 exec 的父子与嵌套 fork 进程中检查连接隔离。测试同时要求父连接继续完成请求，并验证子退出清理不会破坏共享 socket。
 * English: Reuses real X11 protocol fixtures to test connection isolation across no-exec parent/child and nested forks. Tests also require continued parent transfers and child-exit cleanup that preserves shared sockets.
 */
// Test-only: reuse the actual Xlib/XCB/mixed protocol helpers, without exec in
// any child. Returning from main exercises ordinary C++ local/static cleanup.
#define main sakura_protocol_fixture_main
#include "fixture.cpp"
#undef main
#include <sys/wait.h>

/**
 * 中文：递归创建无 exec 子进程，等待每层退出并检查第 32 层新连接被策略以 126 拒绝。
 * English: Recursively forks without exec and waits for each exit, checking that a new connection at the depth limit is rejected with status 126.
 * 参数 / Parameters: `boundedForks(unsigned remaining)`.
 */
static bool boundedForks(unsigned remaining){
  const auto pid=fork();if(pid<0)return false;
  if(!pid){if(remaining==1){Connection overflow("xcb");return false;}std::exit(boundedForks(remaining-1)?0:22);}
  int status=0;return waitpid(pid,&status,0)==pid&&WIFEXITED(status)&&WEXITSTATUS(status)==(remaining==1?126:0);
}

struct MultipleRequest {
  uint32_t parent=0;
  std::vector<uint32_t> pairs;
  /**
   * 中文：为指定数量的文本目标建立独立子属性对和一个父 MULTIPLE 属性。
   * English: Builds separate child-property pairs for the requested text-target count and one parent MULTIPLE property.
   * 参数 / Parameters: `MultipleRequest(Connection& connection,unsigned count=2)`.
   */
  explicit MultipleRequest(Connection& connection,unsigned count=2){
    parent=connection.atom("SAKURA_FORK_PARENT");
    for(unsigned i=0;i<count;++i){pairs.push_back(connection.atom(i%2?"text/plain":"UTF8_STRING"));pairs.push_back(connection.atom(("SAKURA_FORK_DATA_"+std::to_string(i)).c_str()));}
  }
  /**
   * 中文：先写入目标/属性对，再发起指定选择的 MULTIPLE 转换请求。
   * English: Writes the target/property pairs before requesting a MULTIPLE conversion for the supplied selection.
   * 参数 / Parameters: `begin(Connection& connection,uint32_t selection)`.
   */
  void begin(Connection& connection,uint32_t selection){
    connection.change(connection.window,parent,connection.atom("ATOM_PAIR"),32,pairs.data(),pairs.size());
    connection.convert(selection,connection.atom("MULTIPLE"),parent);
  }
  /**
   * 中文：在十五秒内等待唯一通知，核对完整父属性及各子属性均等于预期字节。
   * English: Waits up to fifteen seconds for one notification and checks the complete parent property and every child against expected bytes.
   * 参数 / Parameters: `finish(Connection& connection,const std::string& expected)`.
   */
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
  /**
   * 中文：重读所有子属性，只有类型、长度、剩余字节和内容全部清空才视为拒绝。
   * English: Re-reads every child property and accepts denial only when type, length, remaining bytes and content are all cleared.
   * 参数 / Parameters: `denied(Connection& connection)`.
   */
  bool denied(Connection& connection){
    for(unsigned i=0;i<pairs.size()/2;++i){auto body=connection.get(pairs[i*2+1],0,1048576,false,"poll64",connection.mixed);
      if(body.type||body.count||body.after||!body.bytes.empty())return false;}return true;
  }
};

/**
 * 中文：协调父子进程和外部测试输入，验证继承连接拒绝、新连接可用、嵌套 fork 隔离及父连接继续完成传输。
 * English: Coordinates parent/child processes and test input to verify inherited-connection refusal, fresh connections, nested-fork isolation and continued parent transfers.
 * 参数 / Parameters: `main(int argc,char** argv)`.
 * 设计 / Design: 子进程正常退出触发 C++ 清理；清理继承别名不得向父共享连接发送请求或 shutdown。
 * Normal child exit exercises C++ cleanup, which must not send requests or shut down aliases of the parent's shared connection.
 */
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
