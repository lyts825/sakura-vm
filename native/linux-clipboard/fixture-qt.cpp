#include <QGuiApplication>
#include <QClipboard>
#include <QTimer>
#include <QFile>
#include <iostream>

int main(int argc,char** argv){
  QGuiApplication app(argc,argv);
  if(argc<4)return 1;
  const QString action=QString::fromLocal8Bit(argv[1]),file=QString::fromLocal8Bit(argv[2]);
  const auto mode=argc>4&&QString::fromLocal8Bit(argv[4])=="PRIMARY"?QClipboard::Selection:QClipboard::Clipboard;
  if(action=="owner"){
    QFile input(file);if(!input.open(QIODevice::ReadOnly))return 2;
    app.clipboard()->setText(QString::fromUtf8(input.readAll()),mode);
    std::cout<<"READY"<<std::endl;
    return app.exec();
  }
  QTimer::singleShot(50,[&](){
    const QByteArray data=app.clipboard()->text(mode).toUtf8();
    const QByteArray result=data.isEmpty()?QByteArray("DENIED"):data.toHex();
    if(action=="probe"){QFile output(file);if(!output.open(QIODevice::WriteOnly|QIODevice::Truncate)){app.exit(3);return;}output.write(result);}
    else {std::cout<<result.constData()<<std::endl;app.quit();}
  });
  return app.exec();
}
