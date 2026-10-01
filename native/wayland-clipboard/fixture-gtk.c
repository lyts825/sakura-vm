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

static gboolean key_pressed(GtkWidget *unused, GdkEventKey *event, gpointer data) {
    (void)unused; (void)data;
    if (event->keyval == GDK_KEY_F8) input_received = TRUE;
    return FALSE;
}

static void provide(GtkClipboard *unused, GtkSelectionData *selection, guint info, gpointer user_data) {
    (void)unused; (void)info; (void)user_data;
    gchar *bytes = NULL; gsize size = 0;
    if (g_file_get_contents(input, &bytes, &size, NULL)) {
        gtk_selection_data_set(selection, gdk_atom_intern(mime, FALSE), 8, (const guchar *)bytes, (gint)size);
        g_free(bytes);
    }
}
static void cleared(GtkClipboard *unused, gpointer data) { (void)unused; (void)data; }
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
