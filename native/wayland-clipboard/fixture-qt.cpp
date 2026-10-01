#include <QGuiApplication>
#include <QClipboard>
#include <QMimeData>
#include <QFile>
#include <QSaveFile>
#include <QTimer>
#include <QWindow>
#include <QBackingStore>
#include <QPainter>
#include <QElapsedTimer>
#include <QThread>
#include <QKeyEvent>
#include <QProcess>
#include <QMouseEvent>
#include <iostream>

// A real Qt Wayland window supplies a genuine compositor keyboard focus and
// serial. No X11 selection calls or forged Wayland selection serials are used.
class Window : public QWindow {
    QBackingStore store{this};
public:
    bool inputReceived = false;
    QElapsedTimer inputTime;
    Window() { resize(360, 240); setTitle("Sakura owned native Wayland fixture"); }
    void keyPressEvent(QKeyEvent *event) override {
        if (event->key() == Qt::Key_F8) { inputReceived = true; inputTime.start(); }
    }
    void mousePressEvent(QMouseEvent *) override { inputReceived = true; inputTime.start(); }
    void exposeEvent(QExposeEvent *) override {
        if (!isExposed()) return;
        store.resize(size());
        const QRegion region(QRect(QPoint(), size()));
        store.beginPaint(region);
        QPainter painter(store.paintDevice());
        painter.fillRect(QRect(QPoint(), size()), QColor("#232131"));
        painter.setPen(Qt::white);
        painter.drawText(20, 45, "Sakura native Wayland clipboard fixture");
        painter.end(); store.endPaint(); store.flush(region);
    }
};

class Data : public QMimeData {
    QString file, type;
    int delay;
public:
    Data(QString file, QString type, int delay) : file(std::move(file)), type(std::move(type)), delay(delay) {}
    QStringList formats() const override { return {type}; }
    bool hasFormat(const QString &format) const override { return format == type; }
#if QT_VERSION >= QT_VERSION_CHECK(6, 0, 0)
    QVariant retrieveData(const QString &format, QMetaType) const override {
#else
    QVariant retrieveData(const QString &format, QVariant::Type) const override {
#endif
        if (format != type) return {};
        if (delay) QThread::msleep(static_cast<unsigned long>(delay));
        QFile input(file); return input.open(QIODevice::ReadOnly) ? QVariant(input.readAll()) : QVariant();
    }
};

static bool output(const QString &file, const QByteArray &bytes) {
    QSaveFile value(file);
    return value.open(QIODevice::WriteOnly) && value.write(bytes) == bytes.size() && value.commit();
}

int main(int argc, char **argv) {
    QGuiApplication application(argc, argv);
    if (argc < 5 || !QGuiApplication::platformName().startsWith("wayland")) return 42;
    const QString action = QString::fromLocal8Bit(argv[1]);
    const QString input = QString::fromLocal8Bit(argv[2]);
    const QString marker = QString::fromLocal8Bit(argv[3]);
    const QString mime = QString::fromLocal8Bit(argv[4]);
    const auto mode = argc > 5 && QString::fromLocal8Bit(argv[5]) == "PRIMARY" ? QClipboard::Selection : QClipboard::Clipboard;
    if (mode == QClipboard::Selection && !application.clipboard()->supportsSelection()) {
        output(marker, "UNSUPPORTED-PRIMARY"); return 43;
    }
    const int delay = argc > 6 ? QString::fromLocal8Bit(argv[6]).toInt() : 0;
    Window window; window.showFullScreen();
    QElapsedTimer lifetime; lifetime.start();
    QTimer timer;
    bool initialized = false;
    QObject::connect(&timer, &QTimer::timeout, [&]() {
        if (!initialized && window.isActive() && window.inputReceived) {
            if (action == "owner") {
                application.clipboard()->setMimeData(new Data(input, mime, delay), mode);
                if (!output(marker, "READY " + QGuiApplication::platformName().toUtf8())) application.exit(3);
                initialized = true;
            } else if (action == "probe") {
                // Allow selection offer events following keyboard focus to be
                // dispatched before asking the toolkit for the requested MIME.
                if (window.inputTime.elapsed() < 250) return;
                const auto data = application.clipboard()->mimeData(mode)->data(mime);
                if (!output(marker, data.isEmpty() ? QByteArray("DENIED") : data.toHex())) application.exit(3);
                initialized = true;
            } else if (action == "child") {
                initialized = true;
                QStringList arguments{QStringLiteral("probe"), input, marker, mime};
                if (mode == QClipboard::Selection) arguments << QStringLiteral("PRIMARY");
                if (!QProcess::startDetached(QCoreApplication::applicationFilePath(), arguments)) application.exit(5);
            }
        }
        if (!initialized && lifetime.elapsed() > 10000) {
            output(marker, "NO-NATIVE-FOCUS"); application.exit(4);
        }
    });
    timer.start(25);
    return application.exec();
}
