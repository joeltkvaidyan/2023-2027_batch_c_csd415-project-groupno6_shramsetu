import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, FileText, Megaphone, Bell, IndianRupee } from "lucide-react";
import { api } from "../api/client";

/**
 * Five destinations, not six.
 *
 * Six tabs at 48px each do not fit a 320px phone once the labels are in Tamil or
 * Malayalam, and a sixth tab made every one of them smaller without making any
 * of them easier to reach. Chat moved to the biggest card on the home screen,
 * settings to its own tile, and the badge moved with alerts because the inbox is
 * reachable from nowhere else.
 */
const items = [
  { to: "/worker/dashboard", Icon: Home, key: "nav.home" as const, short: "Home" },
  { to: "/worker/wages", Icon: IndianRupee, key: "nav.wages" as const, short: "Wages" },
  { to: "/worker/documents", Icon: FileText, key: "nav.documents" as const, short: "Docs" },
  { to: "/worker/grievances", Icon: Megaphone, key: "nav.grievances" as const, short: "Grievance" },
  {
    to: "/worker/notifications",
    Icon: Bell,
    key: "nav.alerts" as const,
    short: "Alerts",
    badge: true,
  },
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
      aria-label={t("nav.primary", "Primary")}
      data-testid="bottom-nav"
      /* A dock flush with the bottom edge, not a floating pill: the pill covered
         the last row of every list, and a sticky summary bar had nowhere to sit. */
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface safe-area-bottom"
    >
      <div className="mx-auto max-w-md">
        <div className="flex justify-around">
          {items.map(({ to, Icon, key, short, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? "text-brand-700 dark:text-brand-300"
                    : "text-ink-muted hover:text-ink-secondary"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative flex items-center justify-center px-3.5 py-1">
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
                  <span className="max-w-[68px] truncate text-center leading-tight">
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
