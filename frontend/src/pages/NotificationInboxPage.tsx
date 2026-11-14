import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { api } from "../api/client";

interface WorkerNotification {
  id: number;
  worker_notification_id: number | null;
  title: string;
  body: string;
  priority: string;
  sender_name: string;
  department: string;
  is_broadcast: boolean;
  is_read: boolean;
  read_at: string | null;
  created_at: string | null;
}

export default function NotificationInboxPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<WorkerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [notifRes, countRes] = await Promise.all([
        api.get("/notifications/my"),
        api.get("/notifications/unread-count"),
      ]);
      setNotifications(notifRes.data.notifications || []);
      setUnreadCount(countRes.data.unread_count || 0);
    } catch (err) {
      console.error("Failed to load notifications:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: number) => {
    try {
      await api.post(`/notifications/${notificationId}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-500/20 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700";
      case "high":
        return "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-700";
      case "medium":
        return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700";
      default:
        return "bg-green-500/20 text-green-600 dark:text-green-400 border-green-300 dark:border-green-700";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-32">
      {/* Header — brand gradient with decorative glow */}
      <header className="bg-brand-700 text-white px-5 pt-8 pb-10 rounded-b-[2rem] animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/worker/dashboard")}
              aria-label="Back"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition active:scale-90"
            >
              <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden="true" />
            </button>
            <div>
              <h1 className="text-xl font-bold">{t("notifications.title", "Notifications")}</h1>
              {unreadCount > 0 && (
                <p className="text-brand-100 text-sm">
                  {unreadCount} {t("notifications.unread", "unread")}
                </p>
              )}
            </div>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={async () => {
                for (const n of notifications.filter((n) => !n.is_read)) {
                  await markAsRead(n.id);
                }
              }}
              className="text-sm text-brand-200 hover:text-white font-medium"
            >
              {t("notifications.markAllRead", "Mark all read")}
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="px-4 -mt-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm text-gray-500">{t("notifications.loadError")}</p>
            <button
              onClick={loadNotifications}
              className="text-sm font-semibold text-brand-600 dark:text-brand-400 underline"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📭</div>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              {t("notifications.empty", "No notifications yet")}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
              {t("notifications.emptyDesc", "You'll see notifications from the government here")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => !notif.is_read && markAsRead(notif.id)}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && !notif.is_read) {
                    event.preventDefault();
                    markAsRead(notif.id);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`${notif.title}${notif.is_read ? "" : " (unread)"}`}
                className={`rounded-2xl p-4 border transition cursor-pointer ${
                  notif.is_read
                    ? "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                    : "bg-white dark:bg-gray-800 border-brand-300 dark:border-brand-600 shadow-sm"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* min-w-0: a flex child defaults to min-width:auto, so a long
                      title or an unbroken URL pushed this row 72px past the
                      card and gave the whole page a sideways scroll. */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {!notif.is_read && (
                        <span className="w-2 h-2 bg-brand-500 rounded-full flex-shrink-0" />
                      )}
                      <h3
                        className={`font-semibold text-sm break-words ${
                          notif.is_read
                            ? "text-gray-600 dark:text-gray-400"
                            : "text-gray-900 dark:text-white"
                        }`}
                      >
                        {notif.title}
                      </h3>
                    </div>
                    <p className="text-gray-600 dark:text-gray-300 text-sm mt-1 break-words">
                      {notif.body}
                    </p>
                    {/* Wrap, don't widen: sender + department + date is more
                        text than a 320px card holds on one line. */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400 dark:text-gray-500">
                      <span>
                        {t("notifications.from")}: {notif.sender_name}
                      </span>
                      {notif.department && notif.department !== "general" && (
                        <>
                          <span>•</span>
                          <span>{notif.department}</span>
                        </>
                      )}
                      <span>•</span>
                      <span>
                        {notif.created_at ? new Date(notif.created_at).toLocaleDateString() : "-"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getPriorityColor(
                        notif.priority,
                      )}`}
                    >
                      {notif.priority}
                    </span>
                    {notif.is_broadcast && (
                      <span className="text-xs text-gray-400">
                        📢 {t("notifications.broadcast")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
