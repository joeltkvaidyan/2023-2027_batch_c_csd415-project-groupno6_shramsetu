import { useRef, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Square, Hourglass } from "lucide-react";
import { api, httpStatus } from "../api/client";

/**
 * VoiceRecorder v14 — Raw PCM capture → client-side WAV encoding → Groq Whisper.
 *
 * Why not MediaRecorder? The webm/opus blobs it produces are rejected by
 * Groq as "invalid media file" on some Android WebView/browser combos.
 * Raw PCM → WAV has zero codec ambiguity and works on every phone browser.
 *
 * Flow:
 *   1. getUserMedia audio
 *   2. AudioContext (downsampled to 16 kHz mono) collects Float32 PCM
 *   3. On stop: compute RMS; if silence → clear error, no upload
 *   4. Encode 16-bit WAV in the browser
 *   5. POST /chat/transcribe?language=xx
 */

const TARGET_SAMPLE_RATE = 16000;

function resampleTo16k(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return samples;

  const outputLength = Math.floor((samples.length * TARGET_SAMPLE_RATE) / sourceRate);
  const output = new Float32Array(outputLength);
  const sourcePerOutput = sourceRate / TARGET_SAMPLE_RATE;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex++) {
    const start = outputIndex * sourcePerOutput;
    const end = Math.min(samples.length, (outputIndex + 1) * sourcePerOutput);
    const first = Math.floor(start);
    const last = Math.min(samples.length - 1, Math.ceil(end) - 1);
    let weightedTotal = 0;
    let weightTotal = 0;

    for (let sourceIndex = first; sourceIndex <= last; sourceIndex++) {
      const overlap = Math.min(end, sourceIndex + 1) - Math.max(start, sourceIndex);
      if (overlap > 0) {
        weightedTotal += samples[sourceIndex] * overlap;
        weightTotal += overlap;
      }
    }
    output[outputIndex] = weightTotal ? weightedTotal / weightTotal : 0;
  }

  return output;
}

function enhanceSpeech(samples: Float32Array): Float32Array {
  let mean = 0;
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) mean += sample;
  mean /= Math.max(1, samples.length);
  for (let i = 0; i < samples.length; i++) {
    const centered = samples[i] - mean;
    samples[i] = centered;
    sumSquares += centered * centered;
    peak = Math.max(peak, Math.abs(centered));
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
  const gain = Math.min(3, rms > 0 ? 0.12 / rms : 1, peak > 0 ? 0.85 / peak : 1);
  if (gain !== 1) {
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  }
  return samples;
}

interface VoiceRecorderProps {
  language: string;
  onTranscript: (text: string) => void;
  onError?: (msg: string) => void;
}

export function VoiceRecorder({ language, onTranscript, onError }: VoiceRecorderProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"idle" | "recording" | "transcribing">("idle");
  const [noMicSupport, setNoMicSupport] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(48000);
  const modeRef = useRef<"idle" | "recording" | "transcribing">("idle");

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const stopEverything = useCallback(() => {
    try {
      processorRef.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    processorRef.current = null;
    sourceRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {
      /* context already closed */
    }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setMode("idle");
  }, []);

  // Check mic support on mount (HTTPS required for mediaDevices)
  useEffect(() => {
    const ok = !!navigator.mediaDevices?.getUserMedia;
    if (!ok) {
      setNoMicSupport(true);
      console.warn("[VoiceRecorder] navigator.mediaDevices unavailable — HTTPS required");
    }
    return () => stopEverything();
  }, [stopEverything]);

  /** Encode Float32 mono PCM to a 16-bit WAV blob. */
  const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeStr(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  const startRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.("Voice input requires HTTPS. Open the app with https:// in the address bar.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      await ctx.resume();
      sampleRateRef.current = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      chunksRef.current = [];

      // ScriptProcessorNode is deprecated but universally supported —
      // the pragmatic choice for maximum phone compatibility.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        if (modeRef.current !== "recording") return;
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      // Keep ScriptProcessorNode alive without sending the microphone back
      // through the speakers, which can contaminate the next recording.
      const silentSink = ctx.createGain();
      silentSink.gain.value = 0;
      processor.connect(silentSink);
      silentSink.connect(ctx.destination);

      setMode("recording");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      console.error("[VoiceRecorder] mic error:", name, err instanceof Error ? err.message : err);
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        onError?.(t("voice.errors.micPermission"));
      } else if (name === "NotFoundError") {
        onError?.("No microphone found on this device.");
      } else {
        onError?.(t("voice.errors.recognitionFailed"));
      }
      stopEverything();
    }
  }, [onError, t, stopEverything]);

  const stopAndTranscribe = useCallback(async () => {
    // Detach the audio graph first so onaudioprocess stops firing.
    try {
      processorRef.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* already disconnected */
    }

    // Merge all PCM chunks
    const total = chunksRef.current.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunksRef.current) {
      merged.set(c, off);
      off += c.length;
    }
    chunksRef.current = [];

    const rawRate = sampleRateRef.current;

    // Release mic immediately
    stopEverything();

    // Silence / noise-gate detection: RMS + peak over the raw capture.
    // Ambient room noise (fans, traffic) has low peak amplitude; real
    // speech close to the mic produces peaks near 0.3-0.9.
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < merged.length; i++) {
      const v = merged[i];
      sumSq += v * v;
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, merged.length));
    const durationSec = merged.length / rawRate;

    if (durationSec < 0.7 || rms < 0.004 || peak < 0.05) {
      onError?.(
        "No speech detected in the recording — move closer to the microphone and try again.",
      );
      return;
    }

    const samples = enhanceSpeech(resampleTo16k(merged, rawRate));

    const wav = encodeWav(samples, TARGET_SAMPLE_RATE);
    setMode("transcribing");

    try {
      const formData = new FormData();
      formData.append("file", wav, "recording.wav");

      // Do NOT set Content-Type manually — the browser must add the
      // multipart boundary, otherwise FastAPI rejects the upload.
      const res = await api.post(
        `/chat/transcribe?language=${encodeURIComponent(language)}`,
        formData,
        { timeout: 45000 },
      );

      const text: string = res.data?.text || "";
      if (text.trim()) {
        onTranscript(text.trim());
      } else {
        onError?.(
          "Whisper could not transcribe that recording — please speak a bit louder and try again.",
        );
      }
    } catch (err) {
      const status = httpStatus(err);
      console.error(
        "[VoiceRecorder] transcription error:",
        status,
        err instanceof Error ? err.message : err,
      );
      if (status === 503) {
        // STT runs locally (faster-whisper); a 503 means the engine itself
        // failed — the backend log has the exact cause.
        onError?.("Voice service unavailable. Check the backend log and that ffmpeg is installed.");
      } else if (status === 401) {
        onError?.("Please login first to use voice input.");
      } else if (status === 400) {
        onError?.("Recording was not usable. Please speak a bit louder and try again.");
      } else if (!status) {
        // Backend itself unreachable — never tell the user their voice failed.
        onError?.(
          "Voice service unreachable. Check that the backend (:8000) and AI service (:8100) are running.",
        );
      } else {
        onError?.(t("voice.errors.recognitionFailed"));
      }
    } finally {
      setMode("idle");
    }
  }, [language, onTranscript, onError, t, stopEverything]);

  const toggleRecording = useCallback(() => {
    if (mode === "transcribing") return;
    if (mode === "recording") {
      stopAndTranscribe();
      return;
    }
    if (noMicSupport) {
      onError?.("Voice input requires HTTPS. Open this page using https:// instead of http://");
      return;
    }
    startRecording();
  }, [mode, noMicSupport, startRecording, stopAndTranscribe, onError]);

  return (
    <div className="relative flex flex-col items-center gap-1">
      {noMicSupport && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-yellow-500 text-white text-xs px-3 py-2 rounded-xl shadow-lg whitespace-nowrap z-50">
          🔒 HTTPS required for voice on phone
        </div>
      )}
      <button
        onClick={toggleRecording}
        disabled={mode === "transcribing"}
        aria-label={mode === "recording" ? t("voice.stopRecording") : t("voice.startRecording")}
        aria-pressed={mode === "recording"}
        className={`w-12 h-12 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center shrink-0 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
          mode === "recording"
            ? "bg-red-500 text-white scale-110 shadow-lg shadow-red-500/40 ring-4 ring-red-500/20 animate-pulse-soft"
            : mode === "transcribing"
              ? "bg-amber-500 text-white"
              : "bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 hover:bg-brand-200 dark:hover:bg-brand-900/70 active:scale-95"
        }`}
      >
        {mode === "recording" ? (
          <Square className="h-5 w-5" aria-hidden="true" />
        ) : mode === "transcribing" ? (
          <Hourglass className="h-5 w-5 animate-pulse" aria-hidden="true" />
        ) : (
          <Mic className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
      {mode === "recording" && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900/85 dark:bg-gray-800/95 text-white text-xs px-3 py-1.5 rounded-full whitespace-nowrap z-50 flex items-center gap-2">
          <span className="flex items-end gap-[2px]" aria-hidden="true">
            <span className="w-[3px] h-1.5 bg-red-400 rounded-full animate-pulse-soft" />
            <span className="w-[3px] h-3 bg-red-400 rounded-full animate-pulse-soft [animation-delay:200ms]" />
            <span className="w-[3px] h-2 bg-red-400 rounded-full animate-pulse-soft [animation-delay:400ms]" />
            <span className="w-[3px] h-2.5 bg-red-400 rounded-full animate-pulse-soft [animation-delay:600ms]" />
          </span>
          {t("voice.errors.listening") || "Listening…"}
        </div>
      )}
    </div>
  );
}
