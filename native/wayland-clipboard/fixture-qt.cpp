/**
 * 中文：原生 Qt Wayland 夹具，通过真实全屏窗口取得输入序列，发布或读取精确 MIME 的 CLIPBOARD/PRIMARY 内容。延迟提供者和独立子客户端用于检查工具包生命周期与焦点边界。
 * English: Native Qt Wayland fixture obtains an input serial through a real fullscreen window and publishes/reads exact-MIME CLIPBOARD/PRIMARY content. Delayed providers and independent child clients exercise toolkit lifetimes and focus boundaries.
 */
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
    /**
     * 中文：初始化原生 Wayland 夹具窗口的尺寸和标题，等待真实 compositor 焦点。
     * English: Initializes native Wayland fixture window size/title while waiting for real compositor focus.
     * 参数 / Parameters: `Window()`.
     */
    Window() { resize(360, 240); setTitle("Sakura owned native Wayland fixture"); }
    /**
     * 中文：记录真实 F8 输入并启动输入时刻计时。
     * English: Records real F8 input and starts timing from that input event.
     * 参数 / Parameters: `keyPressEvent(QKeyEvent *event) override`.
     */
    void keyPressEvent(QKeyEvent *event) override {
        if (event->key() == Qt::Key_F8) { inputReceived = true; inputTime.start(); }
    }
    /**
     * 中文：记录真实鼠标输入并重新启动输入时刻计时。
     * English: Records real mouse input and restarts timing from that event.
     * 参数 / Parameters: `mousePressEvent(QMouseEvent *) override`.
     */
    void mousePressEvent(QMouseEvent *) override { inputReceived = true; inputTime.start(); }
    /**
     * 中文：仅在窗口已曝光时通过 backing store 绘制夹具标识。
     * English: Paints fixture identification through its backing store only when the window is exposed.
     * 参数 / Parameters: `exposeEvent(QExposeEvent *) override`.
     */
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
    /**
     * 中文：捕获文件、MIME 和可选延迟供 Qt 延迟数据提供调用使用。
     * English: Captures file, MIME and optional delay for Qt's lazy data-provider calls.
     * 参数 / Parameters: `Data(QString file, QString type, int delay)`.
     */
    Data(QString file, QString type, int delay) : file(std::move(file)), type(std::move(type)), delay(delay) {}
    /**
     * 中文：仅公布夹具配置的一个 MIME，避免提供额外隐式内容格式。
     * English: Advertises only the fixture's configured MIME rather than extra implicit content formats.
     * 参数 / Parameters: `formats() const override`.
     */
    QStringList formats() const override { return {type}; }
    /**
     * 中文：按精确 MIME 字符串判断当前数据提供者是否支持请求格式。
     * English: Tests supported format using an exact MIME string comparison.
     * 参数 / Parameters: `hasFormat(const QString &format) const override`.
     */
    bool hasFormat(const QString &format) const override { return format == type; }
#if QT_VERSION >= QT_VERSION_CHECK(6, 0, 0)
    /**
     * 中文：只为精确 MIME 提供输入文件完整字节，可延迟模拟数据提供者阻塞。
     * English: Provides complete input-file bytes only for the exact MIME, optionally delaying to simulate a blocked provider.
     * 参数 / Parameters: `retrieveData(const QString &format, QMetaType) const override`.
     */
    QVariant retrieveData(const QString &format, QMetaType) const override {
#else
    /**
     * 中文：只为精确 MIME 提供输入文件完整字节，可延迟模拟数据提供者阻塞。
     * English: Provides complete input-file bytes only for the exact MIME, optionally delaying to simulate a blocked provider.
     * 参数 / Parameters: `retrieveData(const QString &format, QVariant::Type) const override`.
     */
    QVariant retrieveData(const QString &format, QVariant::Type) const override {
#endif
        if (format != type) return {};
        if (delay) QThread::msleep(static_cast<unsigned long>(delay));
        QFile input(file); return input.open(QIODevice::ReadOnly) ? QVariant(input.readAll()) : QVariant();
    }
};

/**
 * 中文：通过 QSaveFile 写入完整标记并原子提交，任一写入或提交失败返回 false。
 * English: Writes a complete marker through QSaveFile and commits atomically, returning false for write/commit failure.
 * 参数 / Parameters: `output(const QString &file, const QByteArray &bytes)`.
 */
static bool output(const QString &file, const QByteArray &bytes) {
    QSaveFile value(file);
    return value.open(QIODevice::WriteOnly) && value.write(bytes) == bytes.size() && value.commit();
}

/**
 * 中文：要求原生 Wayland 并核对 PRIMARY 支持，创建真实焦点窗口后执行 owner、probe 或 child 模式。
 * English: Requires native Wayland and checks PRIMARY support, then creates a real-focus window for owner/probe/child mode.
 * 参数 / Parameters: `main(int argc, char **argv)`.
 */
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
    /**
     * 中文：在真实输入和活动焦点后发布选择或读取 MIME；probe 等待 offer 事件，child 启动独立原生客户端。
     * English: Publishes a selection or reads MIME after real input/active focus; probe waits for offer events and child launches an independent native client.
     * 参数 / Parameters: `()`.
     * 设计 / Design: probe 至少等输入后 250ms 才读取，避免焦点紧邻的 offer 尚未分派；十秒无焦点明确输出诊断。
     * Probe waits at least 250ms after input before reading so adjacent offer events can dispatch; ten seconds without focus produces explicit diagnostics.
     */
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
