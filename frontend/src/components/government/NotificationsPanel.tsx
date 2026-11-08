/**
 * Notifications tab of the government dashboard: the send form and the
 * list of sent notifications. Extracted verbatim from
 * GovernmentDashboardPage (behaviour unchanged) — the panel owns the form
 * state; data loading stays with the page.
 */
import { useState } from "react";
import { apiErrorMessage } from "../../api/client";
import { govSendNotification, type GovNotification } from "../../api/governmentClient";

interface NotificationsPanelProps {
  notifications: GovNotification[];
  onSent: () => void;
}

export default function NotificationsPanel({ notifications, onSent }: NotificationsPanelProps) {
  // Notification form
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [notifPriority, setNotifPriority] = useState("medium");
  const [notifTarget, setNotifTarget] = useState("all");
  const [notifTargetValue, setNotifTargetValue] = useState("");
  const [notifSending, setNotifSending] = useState(false);
  const [notifSent, setNotifSent] = useState(false);
  const [notifResult, setNotifResult] = useState("");
  const [notifError, setNotifError] = useState("");

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifTitle || !notifMessage) return;
    setNotifSending(true);
    setNotifError("");
    try {
      const result = await govSendNotification({
        title: notifTitle,
        body: notifMessage,
        priority: notifPriority,
        target: notifTarget,
        // Backend clamps a missing/empty target_value for non-"all" targets
        // back to plain "all" — always send what the officer picked.
        target_value: notifTarget !== "all" ? notifTargetValue : undefined,
      });
      setNotifTitle("");
      setNotifMessage("");
      setNotifTargetValue("");
      setNotifResult(result.detail);
      setNotifSent(true);
      setTimeout(() => setNotifSent(false), 5000);
      onSent();
    } catch (err) {
      console.error(err);
      // Never swallow failures: an officer who sees nothing happen must be
      // told why (validation, session expiry, rate limit, server error).
      setNotifError(apiErrorMessage(err, "Failed to send notification. Please try again."));
    } finally {
      setNotifSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Send Form */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          📤 Send Push Notification to Workers
        </h2>
        {notifSent && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-300 text-sm mb-4">
            ✅ {notifResult || "Notification sent successfully!"}
          </div>
        )}
        {notifError && (
          <div
            className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-300 text-sm mb-4"
            role="alert"
          >
            ⚠️ {notifError}
          </div>
        )}
        <form onSubmit={handleSendNotification} className="space-y-4">
          <div>
            <label htmlFor="notif-title" className="block text-sm text-slate-300 mb-1">
              Title
            </label>
            <input
              id="notif-title"
              type="text"
              value={notifTitle}
              onChange={(e) => setNotifTitle(e.target.value)}
              placeholder="e.g. Important Labour Policy Update"
              required
              minLength={5}
              maxLength={200}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="notif-message" className="block text-sm text-slate-300 mb-1">
              Message
            </label>
            <textarea
              id="notif-message"
              value={notifMessage}
              onChange={(e) => setNotifMessage(e.target.value)}
              placeholder="Detailed notification message for workers..."
              required
              minLength={10}
              maxLength={2000}
              rows={3}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">
              Minimum 5 characters for the title and 10 for the message.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="notif-priority" className="block text-sm text-slate-300 mb-1">
                Priority
              </label>
              <select
                id="notif-priority"
                value={notifPriority}
                onChange={(e) => setNotifPriority(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="low">🟢 Low</option>
                <option value="medium">🟡 Medium</option>
                <option value="high">🟠 High</option>
                <option value="urgent">🔴 Urgent</option>
              </select>
            </div>
            <div>
              <label htmlFor="notif-target" className="block text-sm text-slate-300 mb-1">
                Target
              </label>
              <select
                id="notif-target"
                value={notifTarget}
                onChange={(e) => setNotifTarget(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="all">All Workers</option>
                <option value="by_state">By State</option>
                <option value="by_district">By District</option>
                <option value="by_occupation">By Occupation</option>
                <option value="specific_workers">Specific Workers</option>
              </select>
            </div>
          </div>
          {notifTarget !== "all" && (
            <div>
              <label className="block text-sm text-slate-300 mb-1">
                {notifTarget === "specific_workers"
                  ? "Worker IDs (comma-separated)"
                  : notifTarget === "by_state"
                    ? "State name"
                    : notifTarget === "by_district"
                      ? "District name"
                      : "Occupation"}
              </label>
              <input
                type="text"
                value={notifTargetValue}
                onChange={(e) => setNotifTargetValue(e.target.value)}
                placeholder={
                  notifTarget === "specific_workers"
                    ? "e.g. 3, 7, 12"
                    : notifTarget === "by_state"
                      ? "e.g. Kerala"
                      : notifTarget === "by_district"
                        ? "e.g. Ernakulam"
                        : "e.g. construction"
                }
                required
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={notifSending || !notifTitle || !notifMessage}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition disabled:opacity-50 active:scale-[0.98]"
          >
            {notifSending ? "Sending..." : "📤 Send Notification"}
          </button>
        </form>
      </div>

      {/* Sent Notifications */}
      <div>
        <h3 className="text-lg font-bold mb-3">📋 Sent Notifications</h3>
        {notifications.length === 0 ? (
          <p className="text-slate-500 text-center py-4">No notifications sent yet</p>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => (
              <div key={n.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium">{n.title}</h4>
                    <p className="text-slate-400 text-sm mt-1">{n.body}</p>
                    <p className="text-slate-500 text-xs mt-2">
                      By {n.sender_name} ({n.department}) •{" "}
                      {n.created_at ? new Date(n.created_at).toLocaleString() : "-"} • Target:{" "}
                      {n.target}
                      {n.target_value && ` (${n.target_value})`}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      n.priority === "urgent"
                        ? "bg-red-500/20 text-red-400"
                        : n.priority === "high"
                          ? "bg-orange-500/20 text-orange-400"
                          : n.priority === "medium"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-green-500/20 text-green-400"
                    }`}
                  >
                    {n.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
