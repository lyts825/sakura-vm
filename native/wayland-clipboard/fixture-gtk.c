/**
 * 中文：原生 GTK Wayland 夹具，以真实窗口输入和 compositor 焦点启动选择 owner 或读取请求。按模式写出测试标记，异步读取受焦点等待和内容格式条件约束。
 * English: Native GTK Wayland fixture using real window input and compositor focus to start selection ownership or read requests. It writes mode-specific test markers, with asynchronous reads constrained by focus waits and content-format checks.
 */
#include <gtk/gtk.h>
#include <gdk/gdkwayland.h>
#include <string.h>

/* Real GTK3 Wayland clients, including GTK's nested synchronous clipboard
 * reader. The display backend is checked before a window is created. */
static const char *action, *input, *marker, *mime;
static GtkWidget *window;
static GtkClipboard *clipboard;
static gint64 started;
static gboolean input_received;

/**
 * 中文：记录真实 F8 键事件作为 compositor 输入证据，返回 FALSE 继续正常 GTK 事件传播。
 * English: Records a real F8 key event as compositor-input evidence and returns FALSE to preserve normal GTK event propagation.
 * 参数 / Parameters: `key_pressed(GtkWidget *unused, GdkEventKey *event, gpointer data)`.
 */
static gboolean key_pressed(GtkWidget *unused, GdkEventKey *event, gpointer data) {
    (void)unused; (void)data;
    if (event->keyval == GDK_KEY_F8) input_received = TRUE;
    return FALSE;
}

/**
 * 中文：按请求 MIME 从夹具输入文件提供原字节，读取失败时不设置选择数据。
 * English: Provides original fixture-file bytes for the requested MIME, leaving selection data unset if reading fails.
 * 参数 / Parameters: `provide(GtkClipboard *unused, GtkSelectionData *selection, guint info, gpointer user_data)`.
 */
static void provide(GtkClipboard *unused, GtkSelectionData *selection, guint info, gpointer user_data) {
    (void)unused; (void)info; (void)user_data;
    gchar *bytes = NULL; gsize size = 0;
    if (g_file_get_contents(input, &bytes, &size, NULL)) {
        gtk_selection_data_set(selection, gdk_atom_intern(mime, FALSE), 8, (const guchar *)bytes, (gint)size);
        g_free(bytes);
    }
}
/**
 * 中文：接收 GTK 所有权撤销通知；本夹具未绑定额外资源，因此无需释放动作。
 * English: Receives GTK ownership-clear notification; the fixture binds no extra resources and needs no disposal action.
 * 参数 / Parameters: `cleared(GtkClipboard *unused, gpointer data)`.
 */
static void cleared(GtkClipboard *unused, gpointer data) { (void)unused; (void)data; }
/**
 * 中文：等待真实输入和活动窗口后取得选择所有权或同步读取 MIME，写入标记并停止此计时器。
 * English: Waits for real input/active-window focus before owning or synchronously reading the MIME selection, writes its marker and stops this timer.
 * 参数 / Parameters: `tick(gpointer unused)`.
 * 设计 / Design: GTK 同步读取可进入嵌套事件循环；十秒没有原生焦点时写 NO-NATIVE-FOCUS 并退出。
 * GTK synchronous reads may enter a nested event loop; ten seconds without native focus writes NO-NATIVE-FOCUS and exits.
 */
static gboolean tick(gpointer unused) {
    (void)unused;
    if (input_received && gtk_window_is_active(GTK_WINDOW(window))) {
        if (strcmp(action, "owner") == 0) {
            GtkTargetEntry target = {(gchar *)mime, 0, 0};
            if (!gtk_clipboard_set_with_data(clipboard, &target, 1, provide, cleared, NULL)) return G_SOURCE_REMOVE;
            g_file_set_contents(marker, "READY gtk-wayland", -1, NULL);
        } else {
            GtkSelectionData *selection = gtk_clipboard_wait_for_contents(clipboard, gdk_atom_intern(mime, FALSE));
            gint size = selection ? gtk_selection_data_get_length(selection) : -1;
            if (size > 0) {
                const guchar *bytes = gtk_selection_data_get_data(selection);
                GString *text = g_string_sized_new((gsize)size * 2);
                for (gint n = 0; n < size; ++n) g_string_append_printf(text, "%02x", bytes[n]);
                g_file_set_contents(marker, text->str, (gssize)text->len, NULL);
                g_string_free(text, TRUE);
            } else g_file_set_contents(marker, "DENIED", -1, NULL);
            if (selection) gtk_selection_data_free(selection);
        }
        return G_SOURCE_REMOVE;
    }
    if (g_get_monotonic_time() - started > 10000000) {
        g_file_set_contents(marker, "NO-NATIVE-FOCUS", -1, NULL); gtk_main_quit(); return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}
/**
 * 中文：要求真实 Wayland 后端，创建全屏 GTK 窗口并注册输入与计时处理来运行 CLIPBOARD/PRIMARY 夹具。
 * English: Requires a real Wayland backend, creates a fullscreen GTK window and registers input/timer handlers for the CLIPBOARD/PRIMARY fixture.
 * 参数 / Parameters: `main(int argc, char **argv)`.
 */
int main(int argc, char **argv) {
    gtk_init(&argc, &argv);
    if (argc < 5 || !GDK_IS_WAYLAND_DISPLAY(gdk_display_get_default())) return 42;
    action = argv[1]; input = argv[2]; marker = argv[3]; mime = argv[4];
    clipboard = gtk_clipboard_get(argc > 5 && strcmp(argv[5], "PRIMARY") == 0 ? GDK_SELECTION_PRIMARY : GDK_SELECTION_CLIPBOARD);
    window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), "Sakura owned GTK native Wayland fixture");
    gtk_window_set_default_size(GTK_WINDOW(window), 360, 240);
    gtk_window_fullscreen(GTK_WINDOW(window));
    gtk_widget_add_events(window, GDK_KEY_PRESS_MASK);
    g_signal_connect(window, "key-press-event", G_CALLBACK(key_pressed), NULL);
    gtk_container_add(GTK_CONTAINER(window), gtk_label_new("Sakura native GTK Wayland clipboard fixture"));
    gtk_widget_show_all(window);
    started = g_get_monotonic_time(); g_timeout_add(250, tick, NULL);
    gtk_main(); return 0;
}
