import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudOff, RefreshCw } from "lucide-react";
import {
  getPendingSyncItems,
  isOnline,
  onOnlineStatusChange,
  processSyncQueue,
} from "../services/offlineStorage";

/**
 * One strip for the whole app, not a banner per page.
 *
 * It answers two questions a worker actually asks: "am I offline?" and "is what
 * I just queued still waiting?". Both are only worth saying when the answer is
 * yes, so the strip renders nothing at all when there is a connection and an
 * empty queue — no permanent chrome.
 *
 * `role="status"` + `aria-live="polite"` so a screen reader hears that the phone
 * went offline while the worker is mid-form, without interrupting typing.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : isOnline(),
  );
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => onOnlineStatusChange(setOnline), []);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      getPendingSyncItems()
        .then((items) => {
          if (alive) setPending(items.length);
        })
        // IndexedDB unavailable (private mode) — no queue to report.
        .catch(() => alive && setPending(0));
    };
    refresh();
    const id = window.setInterval(refresh, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Coming back online is the moment to try: waiting for the next interval
  // would leave a queued complaint sitting there while the worker watches.
  useEffect(() => {
    if (!online) return;
    let alive = true;
    setSyncing(true);
    processSyncQueue()
      .catch(() => null)
      .then(() => {
        if (!alive) return;
        return getPendingSyncItems().then((items) => alive && setPending(items.length));
      })
      .catch(() => {})
      .finally(() => alive && setSyncing(false));
    return () => {
      alive = false;
    };
  }, [online]);

  if (online && pending === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-30 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium
        ${
          online
            ? "bg-amber-50 text-amber-900 border-b border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800"
            : "bg-gray-900 text-white"
        }`}
    >
      {online ? (
        <SyncIcon syncing={syncing} />
      ) : (
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>
        {online
          ? pending === 1
            ? t("offline.pendingOne")
            : t("offline.pendingMany", { count: pending })
          : t("offline.offline")}
      </span>
    </div>
  );
}

function SyncIcon({ syncing }: { syncing: boolean }) {
  return (
    <RefreshCw className={`h-4 w-4 shrink-0 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
  );
}
