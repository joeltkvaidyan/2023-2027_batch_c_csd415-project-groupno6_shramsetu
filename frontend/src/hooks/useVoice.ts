import { useCallback, useRef, useState, useEffect } from "react";
import { api, apiErrorMessage } from "../api/client";
import { getLanguage } from "../i18n/languages";

/** Detect if the device is a phone/tablet (not desktop) */
function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Cross-browser voice hook — mobile-friendly.
 *
 * STT (speech → text):
 *   1. Browser-native SpeechRecognition (Chrome/Edge/Safari)
 *   2. Server-side fallback via MediaRecorder + /chat/transcribe
 *      — requires HTTPS for navigator.mediaDevices
 *
 * TTS (text → speech):
 *   1. Server-side gTTS (always works for all 6 languages)
 *
 * Mobile note: on HTTP (not HTTPS), navigator.mediaDevices is unavailable
 * on iOS Safari. Chrome on Android allows it on private networks.
 * We always show the mic button and try our best.
 */
export function useVoice(languageCode: string) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(true);
  const [sttAvailable, setSttAvailable] = useState(true); // Always show mic button
  const [sttMode, setSttMode] = useState<"browser" | "server" | "none">("none");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const speechLocale = getLanguage(languageCode).speechLocale;
  const mobile = isMobile();

  // ── Detect capabilities on mount / language change ───────────────────
  useEffect(() => {
    setVoiceAvailable(true);

    // Check for browser SpeechRecognition (works on most browsers including mobile)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Check for MediaRecorder (needed for server-side STT)
    const hasMediaRecorder = typeof MediaRecorder !== "undefined";
    const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    if (SR) {
      // Browser SpeechRecognition available — try it first
      setSttAvailable(true);
      setSttMode("browser");
    } else if (hasMediaRecorder && hasMediaDevices) {
      // Server-side STT via MediaRecorder
      setSttAvailable(true);
      setSttMode("server");
    } else if (hasMediaRecorder) {
      // MediaRecorder exists but no getUserMedia (HTTP on iOS)
      // Still show mic — will fail gracefully with helpful error
      setSttAvailable(true);
      setSttMode("server");
    } else {
      // No speech capabilities at all
      setSttAvailable(true); // Still show button — show error on tap
      setSttMode("none");
    }
  }, [languageCode, speechLocale]);

  // ── Cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
      audioElRef.current?.pause();
      audioElRef.current = null;
    };
  }, []);

  // ── Server-side TTS (gTTS — always works for all languages) ─────────
  const speakServer = useCallback(
    async (text: string) => {
      try {
        if (audioElRef.current) {
          audioElRef.current.pause();
          audioElRef.current.src = "";
          audioElRef.current.load();
        }

        setIsSpeaking(true);
        setError(null);

        const params = new URLSearchParams({ text, language: languageCode });
        const res = await api.get(`/chat/speak?${params.toString()}`, {
          responseType: "blob",
          timeout: 30000,
        });

        const url = URL.createObjectURL(res.data);
        const audio = new Audio();
        audio.preload = "auto";
        audio.src = url;
        audioElRef.current = audio;

        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(url);
        };

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            setIsSpeaking(false);
          });
        }
      } catch (err) {
        console.error("Server TTS failed:", err instanceof Error ? err.message : err);
        setIsSpeaking(false);
      }
    },
    [languageCode],
  );

  // ── Public speak ────────────────────────────────────────────────────
  const speak = useCallback(
    (text: string) => {
      if (!text) return;
      speakServer(text);
    },
    [speakServer],
  );

  const speakFromUrl = useCallback(
    async (text: string) => {
      await speakServer(text);
    },
    [speakServer],
  );

  // ── Stop speaking ────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = "";
      audioElRef.current.load();
    }
    setIsSpeaking(false);
  }, []);

  // ── Server-side STT (MediaRecorder + cloud Whisper) ──────────────────
  const startServerSTT = useCallback(
    async (onResult: (text: string) => void, onError: (err: string) => void) => {
      // Check if MediaRecorder and getUserMedia are available
      if (typeof MediaRecorder === "undefined") {
        onError("Recording not supported. Please use Chrome or Safari browser.");
        setIsListening(false);
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // On HTTP, navigator.mediaDevices is unavailable on some browsers
        onError("Microphone requires HTTPS. Please access via HTTPS or use Chrome on Android.");
        setIsListening(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;

        // Detect best supported MIME type
        let mimeType = "";
        const candidates = mobile
          ? [
              "audio/mp4",
              "audio/mp4;codecs=mp4a.40.2",
              "audio/webm;codecs=opus",
              "audio/webm",
              "audio/ogg;codecs=opus",
            ]
          : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

        for (const candidate of candidates) {
          if (MediaRecorder.isTypeSupported(candidate)) {
            mimeType = candidate;
            break;
          }
        }

        if (!mimeType) {
          onError("Audio recording not supported on this device.");
          stream.getTracks().forEach((t) => t.stop());
          setIsListening(false);
          return;
        }

        const recorder = new MediaRecorder(stream, { mimeType });
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          setIsListening(false);

          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          if (blob.size < 100) {
            onError("No audio recorded — please try again.");
            return;
          }

          try {
            const ext = mimeType.includes("mp4")
              ? "m4a"
              : mimeType.includes("ogg")
                ? "ogg"
                : "webm";

            const formData = new FormData();
            formData.append("file", blob, `voice.${ext}`);
            // Language goes in the QUERY STRING (the backend reads
            // req.query.language, not the form body). Do NOT set
            // Content-Type manually — the browser must add the multipart
            // boundary, otherwise the upload is rejected.
            const res = await api.post<{ text: string }>(
              `/chat/transcribe?language=${encodeURIComponent(languageCode)}`,
              formData,
            );
            const transcript = res.data.text?.trim();
            if (!transcript) {
              onError("Could not understand the audio — please try again.");
              return;
            }
            onResult(transcript);
          } catch (err) {
            onError(apiErrorMessage(err, "Transcription failed. Please try again."));
          }
        };

        recorder.onerror = () => {
          onError("Recording error — please try again.");
          setIsListening(false);
          stream.getTracks().forEach((t) => t.stop());
        };

        mediaRecorderRef.current = recorder;
        setIsListening(true);
        setError(null);
        recorder.start(1000);
      } catch (err) {
        setIsListening(false);
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError") {
          onError("Microphone permission denied. Please allow microphone in your phone settings.");
        } else if (name === "NotFoundError") {
          onError("No microphone found on this device.");
        } else if (name === "NotReadableError") {
          onError(
            "Microphone is being used by another app. Please close other apps and try again.",
          );
        } else {
          onError("Could not access microphone. Please try again.");
        }
      }
    },
    [languageCode, mobile],
  );

  // ── Browser-native STT ──────────────────────────────────────────────
  const startBrowserSTT = useCallback(
    (onResult: (text: string) => void, onError: (err: string) => void) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        // Fall back to server STT
        startServerSTT(onResult, onError);
        return;
      }

      const recognition = new SR();
      recognition.lang = speechLocale;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        onResult(transcript);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        const map: Record<string, string> = {
          "no-speech": "No speech detected — please try again.",
          "audio-capture": "No microphone found.",
          "not-allowed": "Microphone permission denied. Please allow it in browser settings.",
          network: "Network error — speech recognition needs internet.",
          aborted: "Speech recognition was stopped.",
          "service-not-allowed": "Speech service not allowed. Try again.",
          "not-supported": "Speech recognition not supported.",
        };
        const msg = map[event.error] || `Speech error: ${event.error}`;
        // If browser STT fails, try server STT as fallback
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed" ||
          event.error === "not-supported"
        ) {
          console.warn("Browser STT failed, trying server STT:", event.error);
          startServerSTT(onResult, onError);
        } else {
          onError(msg);
          setIsListening(false);
        }
      };

      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      setIsListening(true);
      setError(null);

      try {
        recognition.start();
      } catch (err) {
        // If start() fails, fall back to server STT
        console.warn("Browser STT start failed, trying server STT:", err);
        startServerSTT(onResult, onError);
      }
    },
    [speechLocale, startServerSTT],
  );

  // ── Public startListening ────────────────────────────────────────────
  const startListening = useCallback(
    (onResult: (text: string) => void, onError?: (err: string) => void) => {
      const handleError = (msg: string) => {
        setError(msg);
        onError?.(msg);
        setIsListening(false);
      };

      setError(null);
      setIsListening(true);

      if (sttMode === "browser") {
        startBrowserSTT(onResult, handleError);
      } else if (sttMode === "server") {
        startServerSTT(onResult, handleError);
      } else {
        // Try browser STT anyway — might work
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR) {
          startBrowserSTT(onResult, handleError);
        } else {
          startServerSTT(onResult, handleError);
        }
      }
    },
    [sttMode, startBrowserSTT, startServerSTT],
  );

  // ── Stop listening ───────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  return {
    isListening,
    isSpeaking,
    voiceAvailable,
    sttAvailable,
    sttMode,
    error,
    mobile,
    startListening,
    stopListening,
    speak,
    speakFromUrl,
    stopSpeaking,
  };
}
