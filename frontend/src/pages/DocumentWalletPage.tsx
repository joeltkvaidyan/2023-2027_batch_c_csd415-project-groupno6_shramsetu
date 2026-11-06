import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Screen } from "../components/Screen";
import { BottomNav } from "../components/BottomNav";
import { api, apiErrorMessage } from "../api/client";
import {
  Button,
  Card,
  ConfirmDialog,
  Modal,
  SkeletonList,
  Badge,
  EmptyState,
} from "../components/ui";
import { InputField } from "../components/InputField";
import {
  cacheDocument,
  getCachedDocument,
  getCachedDocumentIds,
  removeCachedDocument,
  clearAllCachedDocuments,
} from "../services/documentCache";
import {
  isPinSet,
  setPin,
  verifyPin,
  lockWallet,
  getLockoutRemaining,
} from "../services/documentSecurity";
import {
  FileText,
  Image as ImageIcon,
  UploadCloud,
  Download,
  Pencil,
  Trash2,
  Lock,
  Unlock,
  KeyRound,
  CloudUpload,
  CloudOff,
  Eye,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type { DocumentItem } from "../types";

export default function DocumentWalletPage() {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Security state
  const [pinSet, setPinSet] = useState(false);
  const [walletLocked, setWalletLocked] = useState(true);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [initializing, setInitializing] = useState(true);

  // Cache state
  const [cachedIds, setCachedIds] = useState<Set<number>>(new Set());
  const [caching, setCaching] = useState<number | null>(null);

  // Dialogs
  const [renameDoc, setRenameDoc] = useState<DocumentItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteDoc, setDeleteDoc] = useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const updateCachedIds = useCallback(async () => {
    try {
      const ids = await cacheIds();
      setCachedIds(new Set(ids));
    } catch {
      /* offline cache unavailable */
    }
  }, []);

  const updateLockoutTimer = useCallback(() => {
    setLockoutRemaining(getLockoutRemaining());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const pinExists = await isPinSet();
        setPinSet(pinExists);
        setWalletLocked(true);
        lockWallet();
        void updateCachedIds();
        updateLockoutTimer();
      } catch (err) {
        console.error("Failed to check PIN status:", err);
        setPinSet(false);
        setWalletLocked(true);
      } finally {
        setInitializing(false);
      }
    })();
  }, [updateCachedIds, updateLockoutTimer]);

  // One ticking interval while a lockout is running, torn down on unlock or
  // unmount. Previously updateLockoutTimer() returned its cleanup into an
  // effect that ignored it, so the interval outlived the lockout.
  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const timer = setInterval(() => {
      const remaining = getLockoutRemaining();
      setLockoutRemaining(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutRemaining]);

  // Explicit focus instead of autoFocus: the PIN pad should be ready to type
  // into the moment the wallet opens, and the rename field when its dialog
  // opens, but nothing else on the page should steal focus.
  useEffect(() => {
    if (!initializing && walletLocked) pinInputRef.current?.focus();
  }, [initializing, walletLocked]);

  useEffect(() => {
    if (renameDoc) renameInputRef.current?.focus();
  }, [renameDoc]);

  // ── PIN handlers ───────────────────────────────────────────────────
  const handleSetPin = async () => {
    setPinError(null);
    if (newPin.length < 4) return setPinError("PIN must be at least 4 digits");
    if (newPin.length > 8) return setPinError("PIN must be at most 8 digits");
    if (!/^\d+$/.test(newPin)) return setPinError("PIN must contain only numbers");
    if (newPin !== confirmPin) return setPinError("PINs do not match");

    try {
      await setPin(newPin);
      setPinSet(true);
      setShowPinSetup(false);
      setWalletLocked(false);
      setNewPin("");
      setConfirmPin("");
      toast.success(t("documents.pinSetSuccess", "PIN created"));
    } catch (err) {
      setPinError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleVerifyPin = async () => {
    setPinError(null);
    if (pinInput.length < 4) return setPinError("Please enter at least 4 digits");

    try {
      const valid = await verifyPin(pinInput);
      if (valid) {
        setWalletLocked(false);
        setPinInput("");
        setPinError(null);
      } else {
        setPinError("Incorrect PIN. Try again.");
        setPinInput("");
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : String(err));
      setPinInput("");
      updateLockoutTimer();
    }
  };

  const handleLock = () => {
    lockWallet();
    setWalletLocked(true);
    setPinInput("");
  };

  // ── Document handlers ──────────────────────────────────────────────
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await api.get<DocumentItem[]>("/documents", { params: { limit: 100 } });
      setDocuments(res.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (walletLocked) return;
    void loadDocuments();
    void updateCachedIds();
  }, [walletLocked, loadDocuments, updateCachedIds]);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    const form = new FormData();
    form.append("file", file);
    form.append("display_name", file.name);
    try {
      await api.post("/documents", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (evt.total) setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      toast.success(t("documents.uploadSuccess", "Document uploaded"));
      await loadDocuments();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("common.error")));
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (doc: DocumentItem) => {
    try {
      const res = await api.get(`/documents/${doc.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.display_name || `document-${doc.id}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
      toast.error(t("common.error"));
    }
  };

  const handleRename = async () => {
    if (!renameDoc || !renameValue.trim()) return;
    try {
      await api.patch(`/documents/${renameDoc.id}`, { display_name: renameValue.trim() });
      toast.success(t("documents.renameSuccess", "Renamed"));
      setRenameDoc(null);
      await loadDocuments();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("common.error")));
    }
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    setDeleting(true);
    try {
      await removeCachedDocument(deleteDoc.id);
      await api.delete(`/documents/${deleteDoc.id}`);
      toast.success(t("documents.deleteSuccess", "Document deleted"));
      setDeleteDoc(null);
      await loadDocuments();
      await updateCachedIds();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("common.error")));
    } finally {
      setDeleting(false);
    }
  };

  const handleCacheForOffline = async (doc: DocumentItem) => {
    setCaching(doc.id);
    try {
      const res = await api.get(`/documents/${doc.id}/download`, { responseType: "blob" });
      await cacheDocument(doc.id, doc.display_name, doc.content_type, doc.size_bytes, res.data);
      await updateCachedIds();
      toast.success(t("documents.cachedOffline", "Available offline"));
    } catch (err) {
      console.error("Cache failed:", err);
      toast.error(t("common.error"));
    } finally {
      setCaching(null);
    }
  };

  const handleRemoveFromCache = async (doc: DocumentItem) => {
    await removeCachedDocument(doc.id);
    await updateCachedIds();
  };

  const handleViewCached = async (doc: DocumentItem) => {
    const cached = await getCachedDocument(doc.id);
    if (!cached) return;
    const url = URL.createObjectURL(cached.blob);
    window.open(url, "_blank");
  };

  // ── Loading state ──────────────────────────────────────────────────
  if (initializing) {
    return (
      <Screen title={t("documents.title")}>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-brand-500 animate-spin" aria-hidden="true" />
        </div>
      </Screen>
    );
  }

  // ── PIN Setup Screen ───────────────────────────────────────────────
  if (showPinSetup) {
    return (
      <Screen title="🔒 Set Document PIN" onBack={() => setShowPinSetup(false)}>
        <div className="space-y-4 mt-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Set a 4-8 digit PIN to protect your documents.
          </p>
          <InputField
            label="New PIN"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            className="text-center text-2xl tracking-[0.5em]"
            placeholder="••••"
            value={newPin}
            onChange={(e) => {
              setNewPin(e.target.value.replace(/\D/g, ""));
              setPinError(null);
            }}
          />
          <InputField
            label="Confirm PIN"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            className="text-center text-2xl tracking-[0.5em]"
            placeholder="••••"
            value={confirmPin}
            onChange={(e) => {
              setConfirmPin(e.target.value.replace(/\D/g, ""));
              setPinError(null);
            }}
          />
          {newPin && confirmPin && newPin === confirmPin && (
            <p className="text-green-600 text-sm text-center animate-fade">✅ PINs match</p>
          )}
          {newPin && confirmPin && newPin !== confirmPin && (
            <p className="text-red-500 text-sm text-center animate-fade">❌ PINs do not match</p>
          )}
          {pinError && <p className="text-red-600 text-sm text-center">{pinError}</p>}
          <Button
            size="lg"
            className="w-full"
            disabled={newPin.length < 4 || confirmPin.length < 4}
            onClick={handleSetPin}
            icon={<Lock className="h-5 w-5" />}
          >
            Set PIN
          </Button>
        </div>
      </Screen>
    );
  }

  // ── Wallet Locked — always show this first ─────────────────────────
  if (walletLocked) {
    if (!pinSet) {
      return (
        <Screen title="🔒 Document Wallet">
          <div className="space-y-4 mt-8 text-center">
            <div className="mx-auto w-20 h-20 rounded-3xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mb-2 animate-rise">
              <ShieldCheck
                className="h-10 w-10 text-brand-500"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Set Up Document Security
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Create a PIN to protect and access your documents
            </p>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 mx-auto max-w-sm text-left">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                You must set a PIN before accessing documents for the first time.
              </p>
            </div>
            <Button
              size="lg"
              className="w-full max-w-xs mx-auto"
              onClick={() => setShowPinSetup(true)}
              icon={<Lock className="h-5 w-5" />}
            >
              Create PIN
            </Button>
            <button
              onClick={() => (window.location.href = "/roles")}
              className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ← Back to Role Selection
            </button>
          </div>
        </Screen>
      );
    }

    return (
      <Screen title="🔒 Document Wallet">
        <div className="space-y-4 mt-8 text-center">
          <div className="mx-auto w-20 h-20 rounded-3xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mb-2 animate-rise">
            <Lock className="h-10 w-10 text-brand-500" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Enter PIN to Access Documents
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your documents are protected with a PIN
          </p>
          <div className="max-w-xs mx-auto">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={8}
              className="input-field text-center text-2xl tracking-[0.5em]"
              placeholder="••••"
              ref={pinInputRef}
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value.replace(/\D/g, ""));
                setPinError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pinInput.length >= 4) handleVerifyPin();
              }}
            />
          </div>
          {pinError && (
            <p className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-2 mx-4">
              ⚠️ {pinError}
            </p>
          )}
          {lockoutRemaining > 0 && (
            <p className="text-amber-600 text-sm">
              ⏱️ Locked out for {Math.ceil(lockoutRemaining / 60)} more minutes
            </p>
          )}
          <Button
            size="lg"
            className="w-full max-w-xs mx-auto"
            disabled={pinInput.length < 4 || lockoutRemaining > 0}
            onClick={handleVerifyPin}
            icon={<Unlock className="h-5 w-5" />}
          >
            Unlock
          </Button>
          <button
            onClick={() => {
              lockWallet();
              window.location.href = "/roles";
            }}
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ← Back to Role Selection
          </button>
        </div>
      </Screen>
    );
  }

  // ── Main Document Wallet ───────────────────────────────────────────
  return (
    <>
      <Screen title={t("documents.title")}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={handleFileSelected}
        />
        <Button
          size="lg"
          className="w-full mb-3"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          loading={uploading}
          loadingText={uploadProgress > 0 ? `${uploadProgress}%` : t("documents.uploading")}
          icon={<UploadCloud className="h-5 w-5" />}
        >
          {t("documents.upload")}
        </Button>
        {uploading && uploadProgress > 0 && (
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-4 animate-fade">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

        {/* Wallet controls */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={handleLock}
            className="flex-1 text-xs py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-semibold inline-flex items-center justify-center gap-1.5 transition hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Lock
          </button>
          <button
            onClick={() => setShowPinSetup(true)}
            className="flex-1 text-xs py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold inline-flex items-center justify-center gap-1.5 transition hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Change PIN
          </button>
          <button
            onClick={async () => {
              await clearAllCachedDocuments();
              await updateCachedIds();
              toast.success(t("documents.cacheCleared", "Offline cache cleared"));
            }}
            className="flex-1 text-xs py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold inline-flex items-center justify-center gap-1.5 transition hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            <CloudOff className="h-3.5 w-3.5" aria-hidden="true" /> Clear cache
          </button>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {t("documents.myDocuments")}
          </h2>
          <Badge tone="brand" dot>
            {t("documents.pinProtected", "PIN-protected")}
          </Badge>
        </div>

        {loading ? (
          <SkeletonList rows={3} />
        ) : loadError ? (
          <EmptyState
            icon={CloudOff}
            title={t("common.error")}
            description={t("documents.loadErrorHint", "Check your connection and try again.")}
            action={
              <Button variant="secondary" size="sm" onClick={loadDocuments}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t("documents.noDocuments")}
            description={t(
              "documents.noDocumentsHint",
              "Upload your ID cards, certificates and job documents to keep them safe and always available.",
            )}
            action={
              <Button
                onClick={() => fileInputRef.current?.click()}
                icon={<UploadCloud className="h-4 w-4" />}
              >
                {t("documents.upload")}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3 pb-10">
            {documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                isCached={cachedIds.has(doc.id)}
                isCaching={caching === doc.id}
                onDownload={handleDownload}
                onCache={handleCacheForOffline}
                onRemoveCache={handleRemoveFromCache}
                onViewCached={handleViewCached}
                onRename={(d) => {
                  setRenameDoc(d);
                  setRenameValue(d.display_name);
                }}
                onDelete={setDeleteDoc}
                t={t}
              />
            ))}
          </div>
        )}
      </Screen>

      {/* Rename dialog */}
      <Modal
        open={renameDoc !== null}
        onClose={() => setRenameDoc(null)}
        title={t("documents.renameTitle", "Rename document")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRenameDoc(null)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button size="sm" onClick={handleRename} disabled={!renameValue.trim()}>
              {t("common.rename", "Rename")}
            </Button>
          </>
        }
      >
        <input
          ref={renameInputRef}
          className="input-field"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          maxLength={200}
          aria-label={t("documents.renameTitle", "Rename document")}
        />
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteDoc !== null}
        onClose={() => setDeleteDoc(null)}
        onConfirm={handleDelete}
        title={t("documents.deleteTitle", "Delete document")}
        message={`"${deleteDoc?.display_name ?? ""}" — ${t("documents.deleteMessage", "This document will be permanently removed from your wallet.")}`}
        confirmLabel={t("common.delete", "Delete")}
        cancelLabel={t("common.cancel", "Cancel")}
        danger
        loading={deleting}
      />

      <BottomNav />
    </>
  );
}

// ── Document Card Component ──────────────────────────────────────────
function DocumentCard({
  doc,
  isCached,
  isCaching,
  onDownload,
  onCache,
  onRemoveCache,
  onViewCached,
  onRename,
  onDelete,
  t,
}: {
  doc: DocumentItem;
  isCached: boolean;
  isCaching: boolean;
  onDownload: (doc: DocumentItem) => void;
  onCache: (doc: DocumentItem) => void;
  onRemoveCache: (doc: DocumentItem) => void;
  onViewCached: (doc: DocumentItem) => void;
  onRename: (doc: DocumentItem) => void;
  onDelete: (doc: DocumentItem) => void;
  t: TFunction;
}) {
  const isPdf = doc.content_type.includes("pdf");
  const isImage = doc.content_type.startsWith("image/");
  return (
    <Card className="animate-rise">
      <div className="flex items-start gap-3">
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
            isPdf ? "bg-red-50 dark:bg-red-900/20" : "bg-blue-50 dark:bg-blue-900/20"
          }`}
        >
          {isPdf ? (
            <FileText className="h-6 w-6 text-red-500" strokeWidth={1.75} aria-hidden="true" />
          ) : isImage ? (
            <ImageIcon className="h-6 w-6 text-blue-500" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <FileText className="h-6 w-6 text-gray-400" strokeWidth={1.75} aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
            {doc.display_name}
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
            <span>{(doc.size_bytes / 1024).toFixed(0)} KB</span>
            <span>•</span>
            <span>{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ""}</span>
            {isCached && (
              <Badge tone="success" className="!px-1.5 !py-0.5 !text-[10px]">
                Offline
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {isCached ? (
          <button
            onClick={() => onViewCached(doc)}
            className="flex-1 text-xs py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 font-semibold inline-flex items-center justify-center gap-1.5"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> View
          </button>
        ) : (
          <button
            onClick={() => onDownload(doc)}
            className="flex-1 text-xs py-2 rounded-lg bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-semibold inline-flex items-center justify-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> {t("documents.view")}
          </button>
        )}

        {isCached ? (
          <button
            onClick={() => onRemoveCache(doc)}
            title={t("documents.removeOffline", "Remove offline copy")}
            className="text-xs py-2 px-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold"
          >
            <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            onClick={() => onCache(doc)}
            disabled={isCaching}
            title={t("documents.makeOffline", "Save for offline")}
            className="text-xs py-2 px-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold disabled:opacity-50"
          >
            {isCaching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}

        <button
          onClick={() => onRename(doc)}
          title={t("common.rename", "Rename")}
          className="text-xs py-2 px-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          onClick={() => onDelete(doc)}
          title={t("common.delete", "Delete")}
          className="text-xs py-2 px-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-semibold"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </Card>
  );
}

// ── Offline cache helper ──────────────────────────────────────────────
// documentCache is already imported statically at the top of this file, so
// this used to re-import it dynamically, which Vite flags: the module is in
// the static graph anyway, so the dynamic import cannot move it into its own
// chunk and only confused the bundler.
async function cacheIds(): Promise<number[]> {
  return getCachedDocumentIds();
}
