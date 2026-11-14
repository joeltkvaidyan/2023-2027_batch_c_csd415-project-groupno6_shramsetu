import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Screen } from "../components/Screen";
import { BottomNav } from "../components/BottomNav";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { api, apiErrorMessage } from "../api/client";
import { SkeletonList } from "../components/ui";
import { SourceChips } from "../components/SourceChips";
import { Trash2, Sparkles, Volume2, Square, SendHorizontal, ShieldCheck, Info } from "lucide-react";
import type { ChatAnswer, ChatHistoryItem } from "../types";

interface DisplayMessage {
  role: "user" | "assistant";
  text: string;
  meta?: ChatAnswer;
}

const SUGGESTIONS_BY_LANG: Record<string, string[]> = {
  en: [
    "How do I register for e-Shram?",
    "What is the accident insurance cover amount?",
    "How do I file a complaint about unpaid wages?",
  ],
  hi: [
    "à¤ˆ-à¤¶à¥à¤°à¤® à¤®à¥‡à¤‚ à¤ªà¤‚à¤œà¥€à¤•à¤°à¤£ à¤•à¥ˆà¤¸à¥‡ à¤•à¤°à¥‡à¤‚?",
    "à¤¦à¥à¤°à¥à¤˜à¤Ÿà¤¨à¤¾ à¤¬à¥€à¤®à¤¾ à¤•à¤¿à¤¤à¤¨à¥‡ à¤•à¤¾ à¤®à¤¿à¤²à¤¤à¤¾ à¤¹à¥ˆ?",
    "à¤¬à¤•à¤¾à¤¯à¤¾ à¤®à¤œà¤¦à¥‚à¤°à¥€ à¤•à¥€ à¤¶à¤¿à¤•à¤¾à¤¯à¤¤ à¤•à¥ˆà¤¸à¥‡ à¤¦à¤°à¥à¤œ à¤•à¤°à¥‡à¤‚?",
  ],
  bn: [
    "à¦‡-à¦¶à§à¦°à¦®à§‡ à¦•à§€à¦­à¦¾à¦¬à§‡ à¦¨à¦¿à¦¬à¦¨à§à¦§à¦¨ à¦•à¦°à¦¬?",
    "à¦¦à§à¦°à§à¦˜à¦Ÿà¦¨à¦¾ à¦¬à§€à¦®à¦¾ à¦•à¦¤ à¦Ÿà¦¾à¦•à¦¾?",
    "à¦¬à¦•à§‡à¦¯à¦¼à¦¾ à¦®à¦œà§à¦°à¦¿à¦° à¦…à¦­à¦¿à¦¯à§‹à¦— à¦•à§€à¦­à¦¾à¦¬à§‡ à¦•à¦°à¦¬?",
  ],
  te: [
    "à°ˆ-à°¶à±à°°à°®à±â€Œà°²à±‹ à°Žà°²à°¾ à°¨à°®à±‹à°¦à± à°šà±‡à°¸à±à°•à±‹à°µà°¾à°²à°¿?",
    "à°ªà±à°°à°®à°¾à°¦ à°­à±€à°®à°¾ à°Žà°‚à°¤?",
    "à°šà±†à°²à±à°²à°¿à°‚à°šà°¨à°¿ à°œà±€à°¤à°‚ à°«à°¿à°°à±à°¯à°¾à°¦à± à°Žà°²à°¾ à°šà±‡à°¯à°¾à°²à°¿?",
  ],
  ta: [
    "à®ˆ-à®¸à¯à®°à®®à®¤à¯à®¤à®¿à®²à¯ à®ªà®¤à®¿à®µà¯ à®šà¯†à®¯à¯à®µà®¤à¯ à®Žà®ªà¯à®ªà®Ÿà®¿?",
    "à®µà®¿à®ªà®¤à¯à®¤à¯ à®•à®¾à®ªà¯à®ªà¯€à®Ÿà¯ à®Žà®µà¯à®µà®³à®µà¯?",
    "à®¨à®¿à®²à¯à®µà¯ˆ à®•à¯‚à®²à®¿ à®ªà¯à®•à®¾à®°à¯ à®Žà®ªà¯à®ªà®Ÿà®¿?",
  ],
  ml: [
    "à´‡-à´¶àµà´°à´®à´¿àµ½ à´°à´œà´¿à´¸àµà´±àµà´±àµ¼ à´šàµ†à´¯àµà´¯àµà´¨àµà´¨à´¤àµ à´Žà´™àµà´™à´¨àµ†?",
    "à´…à´ªà´•à´Ÿ à´‡àµ»à´·àµà´±àµ»à´¸àµ à´Žà´¤àµà´°?",
    "à´•à´¿à´Ÿàµà´Ÿà´¾à´¤àµà´¤ à´•àµ‚à´²à´¿ à´ªà´°à´¾à´¤à´¿ à´Žà´™àµà´™à´¨àµ†?",
  ],
};

export default function ChatbotPage() {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [assistantUnavailable, setAssistantUnavailable] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lang = i18n.language.split("-")[0];

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    setHistoryError(false);
    api
      .get<ChatHistoryItem[]>("/chat/history")
      .then((res) => {
        const loaded: DisplayMessage[] = res.data.map((item) => {
          // Old history rows may carry stale meta (error-flagged answers from
          // a past outage). Rendering their historical system_error state as
          // if it described the CURRENT assistant made the page open with a
          // permanent "temporarily unavailable" banner â€” so only a fresh
          // error from this session's /chat/ask may set the banner.
          const meta = item.meta && !item.meta.system_error ? item.meta : undefined;
          return {
            role: item.role,
            text: item.content,
            meta,
          };
        });
        setMessages(loaded);
      })
      .catch(() => setHistoryError(true))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const sendQuestion = useCallback(
    async (question: string) => {
      if (!question.trim() || asking) return;
      setMessages((prev) => [...prev, { role: "user", text: question }]);
      setInput("");
      setAsking(true);
      try {
        const res = await api.post<ChatAnswer>("/chat/ask", { question, language: i18n.language });
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: res.data.answer, meta: res.data },
        ]);
        setAssistantUnavailable(Boolean(res.data.system_error));
      } catch (err) {
        // Localised friendly message: network outage, 429 rate limit, or the
        // server's own detail â€” never a raw exception string.
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: apiErrorMessage(err, t("common.error")) },
        ]);
      } finally {
        setAsking(false);
      }
    },
    [asking, i18n.language, t],
  );

  // Dashboard deep links (e.g. the Heat-safety tile) pre-seed a question via
  // navigation state. Send it once, AFTER history settles â€” loadHistory()
  // replaces the message list, so sending earlier would lose the bubble.
  const location = useLocation();
  const initialQuestion = (location.state as { initialQuestion?: string } | null)?.initialQuestion;
  const prefillSentRef = useRef(false);
  useEffect(() => {
    if (!initialQuestion || prefillSentRef.current || historyLoading) return;
    prefillSentRef.current = true;
    void sendQuestion(initialQuestion);
  }, [initialQuestion, historyLoading, sendQuestion]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, asking]);

  const handleVoiceResult = (text: string) => {
    setVoiceError(null);
    sendQuestion(text);
  };

  const handleVoiceError = (msg: string) => {
    setVoiceError(msg);
  };

  const clearChat = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await api.delete("/chat/history");
    } catch {
      // Even if the server call fails, clear locally so the UI stays usable.
    }
    setMessages([]);
    setAssistantUnavailable(false);
    setClearing(false);
  };

  /** TTS: try browser speechSynthesis first, fall back to server-side /chat/speak */
  const handleSpeak = async (text: string, idx: number) => {
    if (speakingIdx === idx) {
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
      audioRef.current = null;
      setSpeakingIdx(null);
      return;
    }

    window.speechSynthesis?.cancel();
    setSpeakingIdx(idx);

    const localeMap: Record<string, string> = {
      en: "en-IN",
      hi: "hi-IN",
      bn: "bn-IN",
      te: "te-IN",
      ta: "ta-IN",
      ml: "ml-IN",
    };
    const speechLocale = localeMap[lang] || "en-IN";

    if ("speechSynthesis" in window) {
      const voices = window.speechSynthesis.getVoices();
      const base = speechLocale.split("-")[0];
      const voice =
        voices.find((v) => v.lang === speechLocale) || voices.find((v) => v.lang.startsWith(base));

      if (voice) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = speechLocale;
        utterance.voice = voice;
        utterance.rate = 0.9;
        utterance.onend = () => setSpeakingIdx(null);
        utterance.onerror = () => {
          setSpeakingIdx(null);
          serverSpeak(text, lang, idx);
        };
        window.speechSynthesis.speak(utterance);
        return;
      }
    }

    serverSpeak(text, lang, idx);
  };

  /** Server-side TTS fallback using /chat/speak endpoint */
  const serverSpeak = async (text: string, lang: string, idx: number) => {
    try {
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
      setSpeakingIdx(idx);
      const res = await api.get("/chat/speak", {
        params: { text: text.substring(0, 500), language: lang },
        responseType: "blob",
      });
      const audioUrl = URL.createObjectURL(res.data);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        audioRef.current = null;
        setSpeakingIdx(null);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onerror = () => {
        audioRef.current = null;
        setSpeakingIdx(null);
        URL.revokeObjectURL(audioUrl);
        setVoiceError("Text-to-speech failed. Your device may not have this language voice pack.");
      };
      await audio.play();
    } catch {
      audioRef.current = null;
      setSpeakingIdx(null);
      setVoiceError("Text-to-speech is not available for this language on your device.");
    }
  };

  const suggestions = SUGGESTIONS_BY_LANG[lang] ?? SUGGESTIONS_BY_LANG.en;

  return (
    <>
      <Screen title={t("chat.title")}>
        {messages.length > 0 && (
          <div className="flex justify-end mb-2 -mt-2">
            <button
              onClick={clearChat}
              disabled={clearing}
              className="min-h-[44px] px-3 text-xs font-medium text-gray-400 hover:text-red-500 disabled:opacity-50 flex items-center gap-1.5 transition rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {clearing ? "â€¦" : t("chat.clearHistory")}
            </button>
          </div>
        )}
        {assistantUnavailable && (
          <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 animate-fade">
            {t("chat.assistantUnavailable")}
          </div>
        )}

        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-label={t("chat.title", "AI Assistant")}
          className="overflow-y-auto pb-40"
          style={{ maxHeight: "calc(100vh - 220px)" }}
        >
          {historyLoading && (
            <div className="py-4">
              <SkeletonList rows={3} />
            </div>
          )}
          {!historyLoading && historyError && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-gray-500">{t("chat.historyLoadError")}</p>
              <button
                onClick={loadHistory}
                className="text-sm font-semibold text-brand-600 dark:text-brand-400 underline"
              >
                {t("common.retry")}
              </button>
            </div>
          )}
          {!historyLoading && !historyError && messages.length === 0 && (
            <div className="py-6">
              {/* Feature intro â€” replaces the bare "start chatting" text */}
              <div className="text-center mb-6 animate-rise">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-600/20 mb-3">
                  <Sparkles className="h-7 w-7 text-white" aria-hidden="true" />
                </div>
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {t("chat.title")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 px-6">
                  {t("chat.emptyState")}
                </p>
              </div>
              {/* Suggested questions â€” instant engagement, zero typing */}
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {t("chat.suggestionsTitle", "Try asking")}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendQuestion(s)}
                    className="text-sm text-left px-3.5 py-2.5 min-h-[44px] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!historyLoading && !historyError && (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <ChatBubble
                  key={i}
                  msg={msg}
                  idx={i}
                  onSpeak={handleSpeak}
                  isSpeaking={speakingIdx === i}
                />
              ))}
              {asking && <ThinkingIndicator />}
            </div>
          )}
        </div>

        {/* Voice-or-type composer â€” lifted above the floating nav dock */}
        <div className="fixed bottom-24 left-0 right-0 bg-gray-50/90 dark:bg-gray-950/90 backdrop-blur-xl px-4 py-3 border-t border-gray-200/70 dark:border-gray-700/60">
          <div className="max-w-md mx-auto">
            {voiceError && (
              <p
                className="text-red-500 text-xs mb-2 flex items-center gap-1"
                role="alert"
                aria-live="assertive"
              >
                {voiceError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <VoiceRecorder
                language={i18n.language}
                onTranscript={handleVoiceResult}
                onError={handleVoiceError}
              />
              <input
                className="input-field flex-1 !py-2.5"
                placeholder={t("chat.placeholder")}
                aria-label={t("chat.placeholder")}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendQuestion(input)}
              />
              <button
                onClick={() => sendQuestion(input)}
                disabled={!input.trim() || asking}
                aria-label={t("chat.send")}
                className="w-11 h-11 rounded-full bg-gradient-to-b from-brand-500 to-brand-600 text-white flex items-center justify-center shrink-0 disabled:opacity-40 transition hover:from-brand-400 hover:to-brand-700 active:scale-95 shadow-md shadow-brand-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                <SendHorizontal className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </Screen>
      <BottomNav />
    </>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  msg,
  idx,
  onSpeak,
  isSpeaking,
}: {
  msg: DisplayMessage;
  idx: number;
  onSpeak: (text: string, idx: number) => void;
  isSpeaking: boolean;
}) {
  const { t } = useTranslation();
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
          isUser
            ? "bg-gradient-to-br from-brand-600 to-brand-700 text-white rounded-br-md shadow-md shadow-brand-600/20"
            : "bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-bl-md shadow-card"
        }`}
      >
        <p className={isUser ? "" : "text-gray-900 dark:text-gray-100 whitespace-pre-wrap"}>
          {msg.text}
        </p>
        {!isUser && msg.meta && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
            {msg.meta.system_error ? (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {t("chat.assistantUnavailable")}
              </p>
            ) : msg.meta.grounded ? (
              <>
                <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                  {msg.meta.simple_explanation}
                </p>

                {/* Source citations: each chip opens the record behind it */}
                {msg.meta.sources && msg.meta.sources.length > 0 && (
                  <SourceChips sources={msg.meta.sources} />
                )}
                {!msg.meta.sources && msg.meta.source_document && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-semibold">{t("chat.sourceDocument")}:</span>{" "}
                    {msg.meta.source_document}
                    {msg.meta.government_department ? ` â€¢ ${msg.meta.government_department}` : ""}
                  </p>
                )}

                {/* Grounding + confidence â€” subtle, honest, not scary numbers */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 dark:text-green-400">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("chat.notVerified", "") === ""
                      ? "Verified from government documents"
                      : t("chat.groundedBadge", "Verified source")}
                  </span>
                  <button
                    onClick={() => onSpeak(msg.text, idx)}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold transition ${
                      isSpeaking
                        ? "text-red-500"
                        : "text-brand-600 dark:text-brand-400 hover:underline"
                    }`}
                  >
                    {isSpeaking ? (
                      <>
                        <Square className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="flex items-end gap-[2px]" aria-hidden="true">
                          <span className="w-[3px] h-2 bg-current rounded-full animate-pulse-soft" />
                          <span className="w-[3px] h-3 bg-current rounded-full animate-pulse-soft [animation-delay:200ms]" />
                          <span className="w-[3px] h-1.5 bg-current rounded-full animate-pulse-soft [animation-delay:400ms]" />
                        </span>
                      </>
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {isSpeaking ? t("chat.stopPlaying") : t("chat.playAnswer")}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                {t("chat.notVerified")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
