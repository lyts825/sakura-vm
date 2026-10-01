#include <QGuiApplication>
#include <QClipboard>
#include <QMimeData>
#include <QTimer>
#include <QFile>
#include <QElapsedTimer>
#include <QThread>
#include <xcb/xcb.h>
#include <cstring>
#include <atomic>
#include <dlfcn.h>
#include <iostream>

static std::atomic<unsigned> incrHeaders{0};
static uint32_t incrAtom=0;
// Count actual Qt INCR property writes without changing request limits, bytes,
// or event handling. RTLD_NEXT retains the production preload when present.
#define COUNT_INCR(name) extern "C" xcb_void_cookie_t name(xcb_connection_t* connection,uint8_t mode,xcb_window_t window,xcb_atom_t property,xcb_atom_t type,uint8_t format,uint32_t count,const void* data){ \
  if(incrAtom&&type==incrAtom&&mode==XCB_PROP_MODE_REPLACE&&format==32&&count==1)incrHeaders.fetch_add(1); \
  static auto original=reinterpret_cast<decltype(&name)>(dlsym(RTLD_NEXT,#name));return original(connection,mode,window,property,type,format,count,data);}
COUNT_INCR(xcb_change_property)
COUNT_INCR(xcb_change_property_checked)

int main(int argc,char** argv){
  QGuiApplication app(argc,argv);
  if(argc<4)return 1;
  const QString action=QString::fromLocal8Bit(argv[1]),file=QString::fromLocal8Bit(argv[2]);
  const auto mode=argc>4&&QString::fromLocal8Bit(argv[4])=="PRIMARY"?QClipboard::Selection:QClipboard::Clipboard;
  if(action=="owner"||action=="owner-binary"){
    auto wire=xcb_connect(nullptr,nullptr);if(xcb_connection_has_error(wire))return 2;
    auto reply=xcb_intern_atom_reply(wire,xcb_intern_atom(wire,0,4,"INCR"),nullptr);incrAtom=reply?reply->atom:0;free(reply);xcb_disconnect(wire);
    QFile input(file);if(!input.open(QIODevice::ReadOnly))return 2;
    const auto data=input.readAll();
    if(action=="owner-binary"){auto mime=new QMimeData;mime->setData("application/sakura-first",data);mime->setData("application/sakura-second",data);app.clipboard()->setMimeData(mime,mode);}
    else app.clipboard()->setText(QString::fromUtf8(data),mode);
    if(QString::fromLocal8Bit(argv[3]).startsWith("/var/tmp/sakura-x11-smoke-")){auto timer=new QTimer(&app);QObject::connect(timer,&QTimer::timeout,[&](){QFile output(QString::fromLocal8Bit(argv[3]));if(output.open(QIODevice::WriteOnly|QIODevice::Truncate))output.write(QByteArray::number(incrHeaders.load()));});timer->start(20);}
    std::cout<<"READY"<<std::endl;
    return app.exec();
  }
  if(action=="multiple"||action=="multiple-binary"||action=="multiple-probe"||action=="self-multiple"){
    QFile input(action=="multiple"||action=="multiple-binary"?file:QString::fromLocal8Bit(argv[3]));if(!input.open(QIODevice::ReadOnly))return 2;
    const auto expected=input.readAll();if(action=="self-multiple")app.clipboard()->setText(QString::fromUtf8(expected),mode);
    QTimer::singleShot(50,[&](){
      int screen=0;auto wire=xcb_connect(nullptr,&screen);bool accepted=!xcb_connection_has_error(wire);
      auto atom=[&](const char* name){auto reply=xcb_intern_atom_reply(wire,xcb_intern_atom(wire,0,std::strlen(name),name),nullptr);const auto value=reply?reply->atom:0;free(reply);return value;};
      auto screens=xcb_setup_roots_iterator(xcb_get_setup(wire));while(screen--&&screens.rem)xcb_screen_next(&screens);
      const auto window=xcb_generate_id(wire),parent=atom("SAKURA_QT_MULTIPLE"),pair=atom("ATOM_PAIR");
      uint32_t mask=XCB_EVENT_MASK_PROPERTY_CHANGE;xcb_create_window(wire,XCB_COPY_FROM_PARENT,window,screens.data->root,0,0,1,1,0,XCB_WINDOW_CLASS_INPUT_OUTPUT,screens.data->root_visual,XCB_CW_EVENT_MASK,&mask);
      uint32_t pairs[6]{atom(action=="multiple-binary"?"application/sakura-first":"UTF8_STRING"),atom("SAKURA_QT_FIRST"),atom(action=="multiple-binary"?"application/sakura-second":"text/plain"),atom("SAKURA_QT_SECOND"),atom("SAKURA_QT_UNKNOWN"),atom("SAKURA_QT_FAILED")};
      xcb_change_property(wire,XCB_PROP_MODE_REPLACE,window,parent,pair,32,6,pairs);
      xcb_convert_selection(wire,window,atom(mode==QClipboard::Selection?"PRIMARY":"CLIPBOARD"),atom("MULTIPLE"),parent,XCB_CURRENT_TIME);xcb_flush(wire);
      bool notified=false;unsigned notifications=0;QElapsedTimer timer;timer.start();
      while(!notified&&timer.elapsed()<15000){while(auto event=xcb_poll_for_event(wire)){if((event->response_type&127)==XCB_SELECTION_NOTIFY){auto response=reinterpret_cast<xcb_selection_notify_event_t*>(event);notified=true;++notifications;accepted=accepted&&response->property==parent;}free(event);}app.processEvents();QThread::msleep(1);}
      accepted=accepted&&notified;
      auto probe=xcb_get_property_reply(wire,xcb_get_property(wire,0,window,parent,XCB_GET_PROPERTY_TYPE_ANY,0,0),nullptr);
      accepted=accepted&&probe&&probe->type==pair&&probe->format==32&&probe->value_len==0&&probe->bytes_after==24;free(probe);
      auto list=xcb_get_property_reply(wire,xcb_get_property(wire,0,window,parent,XCB_GET_PROPERTY_TYPE_ANY,0,64),nullptr);
      accepted=accepted&&list&&list->type==pair&&list->format==32&&list->value_len==6&&!list->bytes_after;
      if(list&&list->value_len==6){uint32_t output[6];std::memcpy(output,xcb_get_property_value(list),24);accepted=accepted&&output[0]==pairs[0]&&output[1]==pairs[1]&&output[2]==pairs[2]&&output[3]==pairs[3]&&((output[4]==pairs[4]&&!output[5])||(!output[4]&&output[5]==pairs[5]));
        for(unsigned i=1;i<4;i+=2){auto value=xcb_get_property_reply(wire,xcb_get_property(wire,0,window,output[i],XCB_GET_PROPERTY_TYPE_ANY,0,1048576),nullptr);
          accepted=accepted&&value&&value->format==8&&!value->bytes_after&&QByteArray(static_cast<const char*>(xcb_get_property_value(value)),xcb_get_property_value_length(value))==expected;free(value);}}
      free(list);timer.restart();while(timer.elapsed()<50){while(auto event=xcb_poll_for_event(wire)){if((event->response_type&127)==XCB_SELECTION_NOTIFY)++notifications;free(event);}app.processEvents();QThread::msleep(1);}
      accepted=accepted&&notifications==1;xcb_destroy_window(wire,window);xcb_disconnect(wire);const QByteArray result=accepted?"MULTIPLE-COMPLETE":"DENIED";
      if(action=="multiple"||action=="multiple-binary"){std::cout<<result.constData()<<std::endl;app.quit();}
      else{QFile output(file);if(!output.open(QIODevice::WriteOnly|QIODevice::Truncate)){app.exit(3);return;}output.write(result);}
    });return app.exec();
  }
  QTimer::singleShot(50,[&](){
    const QByteArray data=app.clipboard()->text(mode).toUtf8();
    const QByteArray result=data.isEmpty()?QByteArray("DENIED"):data.toHex();
    if(action=="probe"){QFile output(file);if(!output.open(QIODevice::WriteOnly|QIODevice::Truncate)){app.exit(3);return;}output.write(result);}
    else {std::cout<<result.constData()<<std::endl;app.quit();}
  });
  return app.exec();
}
