import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, FileText, Megaphone, Bell, MessageCircle, Settings } from "lucide-react";
import { api } from "../api/client";

const items = [
  { to: "/worker/dashboard", Icon: Home, key: "nav.home" as const, short: "Home" },
  { to: "/worker/documents", Icon: FileText, key: "nav.documents" as const, short: "Docs" },
  { to: "/worker/grievances", Icon: Megaphone, key: "nav.grievances" as const, short: "Grievance" },
  {
    to: "/worker/notifications",
    Icon: Bell,
    key: "nav.alerts" as const,
    short: "Alerts",
    badge: true,
  },
  { to: "/worker/chat", Icon: MessageCircle, key: "nav.chat" as const, short: "Chat" },
  { to: "/worker/settings", Icon: Settings, key: "nav.settings" as const, short: "Settings" },
];

export function BottomNav() {
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .get<{ unread_count: number }>("/notifications/unread-count")
      .then((res) => {
        if (active) setUnread(res.data.unread_count ?? 0);
      })
      .catch(() => {
        /* badge stays at 0 — non-critical */
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none safe-area-bottom"
    >
      {/* Floating dock. Opaque on purpose: it sits over scrolling cards, and
          a translucent bar let the text underneath read as overlapping text. */}
      <div className="max-w-md mx-auto px-4 pb-3">
        <div
          className="pointer-events-auto bg-white dark:bg-gray-900 shadow-dock border border-gray-200 dark:border-gray-800
            rounded-[1.75rem] flex justify-around px-2 py-2"
        >
          {items.map(({ to, Icon, key, short, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 px-1 py-0.5 rounded-2xl text-[10px] font-semibold min-w-[50px] flex-1 transition-colors ${
                  isActive
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`relative flex items-center justify-center transition-all ${
                      isActive
                        ? "bg-brand-600 text-white rounded-full px-3.5 py-1 shadow-glow-brand"
                        : "px-3.5 py-1"
                    }`}
                  >
                    <Icon
                      className="h-[21px] w-[21px]"
                      strokeWidth={isActive ? 2.25 : 1.75}
                      aria-hidden="true"
                    />
                    {badge && unread > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none ring-2 ring-white dark:ring-gray-900">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </span>
                  {/* Short, dedicated nav.* labels — NOT the page-title keys these
                  used to borrow (e.g. dashboard.welcome = "Welcome",
                  dashboard.aiChatbot = "AI Welfare Assistant"), which were both
                  semantically wrong for a tab label and far too long to fit
                  here, especially in longer scripts (Bengali/Tamil/Telugu/
                  Malayalam). Still truncates as a last-resort safety net, not
                  as the primary fix. */}
                  <span className="truncate max-w-[60px] text-center leading-tight">
                    {t(key, short)}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
