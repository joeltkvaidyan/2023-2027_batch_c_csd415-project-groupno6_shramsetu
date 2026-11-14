/**
 * Push Notifications Hook
 * Handles Firebase Cloud Messaging (FCM) registration and permissions
 */
import { useState, useEffect, useCallback } from "react";
import { api, apiErrorMessage } from "../api/client";

/** Shape of a Web Push message body (RFC 8030 payload as we send it). */
interface PushPayload {
  notification: { title: string; body?: string };
  data?: Record<string, unknown>;
}

type PushEvent = Event & { data: { json: () => PushPayload } | null };

interface PushNotificationState {
  isSupported: boolean;
  isPermissionGranted: boolean;
  fcmToken: string | null;
  error: string | null;
}

// FCM registration is not wired yet: the hook reports capability only and the
// server-side push sender does not exist. VITE_FIREBASE_* values were being
// read into an object nothing consumed, which made a half-configured feature
// look implemented. Add the SDK call and this config together, with tests.

export function usePushNotifications() {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isPermissionGranted: false,
    fcmToken: null,
    error: null,
  });

  // Check if push notifications are supported
  useEffect(() => {
    const isSupported = "serviceWorker" in navigator && "PushManager" in window;
    setState((prev) => ({ ...prev, isSupported }));
  }, []);

  // Request permission and get FCM token
  const requestPermission = useCallback(async () => {
    if (!state.isSupported) {
      setState((prev) => ({ ...prev, error: "Push notifications not supported" }));
      return false;
    }

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setState((prev) => ({
          ...prev,
          isPermissionGranted: false,
          error: "Notification permission denied",
        }));
        return false;
      }

      setState((prev) => ({ ...prev, isPermissionGranted: true }));

      // For production, initialize Firebase and get FCM token
      // For now, we'll use a placeholder
      const fcmToken = `placeholder-token-${Date.now()}`;

      // Register token with backend
      await api.post("/notifications/register", {
        token: fcmToken,
        platform: "web",
      });

      setState((prev) => ({
        ...prev,
        fcmToken,
        error: null,
      }));

      return true;
    } catch (error: unknown) {
      console.error("Push notification setup error:", error);
      setState((prev) => ({
        ...prev,
        error: apiErrorMessage(error, "Failed to setup push notifications"),
      }));
      return false;
    }
  }, [state.isSupported]);

  // Unregister from push notifications
  const unregister = useCallback(async () => {
    if (state.fcmToken) {
      try {
        await api.delete(`/notifications/unregister?token=${state.fcmToken}`);
        setState((prev) => ({
          ...prev,
          fcmToken: null,
          isPermissionGranted: false,
        }));
      } catch (error) {
        console.error("Unregister error:", error);
      }
    }
  }, [state.fcmToken]);

  // Listen for incoming push notifications
  useEffect(() => {
    if (!state.isSupported || !state.isPermissionGranted) return;

    const handleNotification = (event: Event) => {
      const pushEvent = event as PushEvent;
      const data = pushEvent.data?.json();
      if (data) {
        // Show local notification
        new Notification(data.notification.title, {
          body: data.notification.body,
          icon: "/logo192.png",
          badge: "/badge-72x72.png",
          data: data.data,
        });
      }
    };

    // Register service worker for push notifications
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.addEventListener("push", handleNotification);
      });
    }

    return () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.removeEventListener("push", handleNotification);
        });
      }
    };
  }, [state.isSupported, state.isPermissionGranted]);

  return {
    ...state,
    requestPermission,
    unregister,
  };
}
