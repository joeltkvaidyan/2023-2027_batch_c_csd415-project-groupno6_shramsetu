import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Printer, ShieldCheck, AlertTriangle } from "lucide-react";
import { Screen } from "../components/Screen";
import { Button, Card, Badge } from "../components/ui";
import { InsurancePanel } from "../components/InsurancePanel";
import { api, apiErrorMessage } from "../api/client";
import { getMyInsurance, type OwnInsurance } from "../api/insuranceClient";

/**
 * Printable worker identity card.
 *
 * Inherited from the Tamil Nadu migrant-worker project (which rendered a PDF
 * with reportlab), reimplemented as a print-styled screen:
 *   - Indic names render correctly, because the phone's own fonts do the work
 *     (Helvetica in the original mangled every non-Latin script);
 *   - there is no PDF library to install, and the card can never drift from the
 *     rest of the app's design tokens.
 *
 * "Print / Save as PDF" opens the browser's print dialog; the surrounding app
 * chrome is hidden by the `print:hidden` classes below, so what lands on paper
 * is the card alone.
 *
 * The QR encodes a verification URL carrying a keyed token (see
 * server/src/utils/cardToken.js), not the worker code by itself: worker codes
 * are sequential, so a bare-code URL would let anyone enumerate the registry.
 *
 * The insurance line is the one claim on the card that is not an identity fact:
 * it is derived from the policy dates server-side, so the printed card can only
 * carry cover that was in force the day it was printed.
 */
interface CardInsurance {
  covered: boolean;
  status: "active" | "expired" | "upcoming" | "none";
  provider: string | null;
  policy_number: string | null;
  coverage: string | null;
  sum_insured: number | null;
  valid_to: string | null;
  verification: "self_declared" | "office_verified" | null;
}

interface CardData {
  worker_id: string | null;
  full_name: string;
  occupation: string | null;
  years_of_experience: number | null;
  district: string | null;
  state: string | null;
  mobile_number: string;
  registered_on: string | null;
  status: "pending" | "accepted" | "rejected";
  issued: boolean;
  verify_code: string | null;
  verify_url: string | null;
  insurance?: CardInsurance | null;
}

function useFormattedDate() {
  const { i18n } = useTranslation();
  return (iso: string | null) => {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    try {
      return date.toLocaleDateString(i18n.language, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return date.toISOString().slice(0, 10);
    }
  };
}

function useFormattedMoney() {
  const { i18n } = useTranslation();
  return (amount: number | null) => {
    if (amount == null) return "—";
    try {
      return new Intl.NumberFormat(i18n.language === "en" ? "en-IN" : i18n.language, {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `₹${amount}`;
    }
  };
}

/**
 * Where a scanned QR should land: the SPA origin, which this page is running on.
 *
 * The server's own `verify_url` is built from PUBLIC_APP_URL or the API's origin,
 * and the API is frequently a different host from the app (dev: :8000 vs :5180;
 * production: api.example.org vs app.example.org). Since the card is printed
 * from the app, window.location.origin is the one origin that is always right.
 * The server value stays as the fallback for non-browser consumers.
 */
function verifyUrlFor(card: CardData): string | null {
  if (!card.verify_code) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : null;
  return origin ? `${origin}/verify/${card.verify_code}` : card.verify_url;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="text-sm font-medium break-words text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}

export default function WorkerIdCardPage() {
  const { t } = useTranslation();
  const formatDate = useFormattedDate();
  const formatMoney = useFormattedMoney();
  const [card, setCard] = useState<CardData | null>(null);
  const [insurance, setInsurance] = useState<OwnInsurance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // The panel's own list is reloaded after an add or a removal, but the card
  // must reload with it: the card is the thing the new policy changes.
  useEffect(() => {
    if (reloadKey === 0) return;
    let alive = true;
    Promise.all([api.get<CardData>("/id-card"), getMyInsurance()])
      .then(([cardRes, ins]) => {
        if (!alive) return;
        setCard(cardRes.data);
        setInsurance(ins);
      })
      .catch(() => {
        /* the initial load's error state already covers a dead server */
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    api
      .get<CardData>("/id-card")
      .then((res) => {
        if (alive) setCard(res.data);
      })
      .catch((err) => {
        if (alive)
          setError(apiErrorMessage(err, t("idCard.loadFailed", "Could not load your ID card.")));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => {
    let alive = true;
    getMyInsurance()
      .then((ins) => {
        if (alive) setInsurance(ins);
      })
      .catch(() => {
        /* the ID card request above already reports a connection failure */
      });
    return () => {
      alive = false;
    };
  }, []);
  const place =
    [card?.district, card?.state].filter(Boolean).join(", ") ||
    t("common.notProvided", "Not provided");
  const verifyUrl = card ? verifyUrlFor(card) : null;

  return (
    <Screen title={t("idCard.title", "Worker ID card")} onBack={true}>
      <div className="print:hidden">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            "idCard.subtitle",
            "Your identity card for employers and labour-office checks. Print it, or save it as a PDF.",
          )}
        </p>
      </div>

      {loading && <p className="mt-4 text-sm text-gray-500">{t("common.loading", "Loading...")}</p>}

      {error && (
        <Card className="mt-4 border-red-200 dark:border-red-900">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </Card>
      )}

      {card && (
        <>
          {!card.issued && (
            <Card className="mt-4 flex items-start gap-3 border-amber-200 dark:border-amber-900">
              <AlertTriangle
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {t("idCard.notIssuedTitle", "This card is not issued yet")}
                </p>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  {t(
                    "idCard.notIssuedBody",
                    "A labour-office official must accept your registration before the card can be verified. You can print it, but the QR will not verify until then.",
                  )}
                </p>
              </div>
            </Card>
          )}

          {/* The card itself. Everything inside survives printing. */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900 print:shadow-none">
            <div className="flex items-start justify-between gap-3 bg-brand-700 px-4 py-3 text-white">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-100">
                  {t("idCard.issuer", "ShramSetu · Labour Department")}
                </p>
                <p className="mt-0.5 text-base font-bold">
                  {t("idCard.cardType", "Worker Identity Card")}
                </p>
              </div>
              <ShieldCheck className="h-6 w-6 shrink-0 text-brand-100" aria-hidden="true" />
            </div>

            <div className="flex items-start justify-between gap-3 px-4 pt-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-gray-900 dark:text-gray-100">
                  {card.full_name}
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-brand-700 dark:text-brand-400">
                  {card.worker_id ?? "—"}
                </p>
                <div className="mt-2">
                  <Badge tone={card.status === "accepted" ? "success" : "warning"}>
                    {card.status === "accepted"
                      ? t("idCard.accepted", "Verified worker")
                      : t("idCard.pending", "Awaiting approval")}
                  </Badge>
                </div>
              </div>

              {verifyUrl && (
                <div className="shrink-0 text-center">
                  <span className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-600">
                    <QRCodeSVG
                      value={verifyUrl}
                      size={78}
                      level="M"
                      aria-label={t("idCard.qrLabel", "Verification QR code")}
                      role="img"
                    />
                  </span>
                  <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-gray-400">
                    {t("idCard.scanToVerify", "Scan to verify")}
                  </p>
                </div>
              )}
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 border-t border-gray-100 px-4 pb-3 dark:border-gray-800">
              <Row
                label={t("idCard.occupation", "Work")}
                value={card.occupation || t("common.notProvided", "Not provided")}
              />
              <Row
                label={t("idCard.experience", "Experience")}
                value={
                  card.years_of_experience != null
                    ? t("idCard.years", "{count} years", { count: card.years_of_experience })
                    : t("common.notProvided", "Not provided")
                }
              />
              <Row label={t("idCard.place", "Place")} value={place} />
              <Row
                label={t("idCard.registeredOn", "Registered on")}
                value={formatDate(card.registered_on)}
              />
              <div className="col-span-2 py-1.5">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {t("idCard.insurance", "Insurance")}
                </dt>
                {card.insurance?.covered ? (
                  <dd className="mt-0.5 space-y-1">
                    <p className="text-sm font-medium break-words text-gray-900 dark:text-gray-100">
                      {t(
                        "idCard.insuranceLine",
                        "{provider} · cover {amount} · valid until {date}",
                        {
                          provider: card.insurance.provider ?? "—",
                          amount: formatMoney(card.insurance.sum_insured),
                          date: formatDate(card.insurance.valid_to),
                        },
                      )}
                    </p>
                    <Badge
                      tone={
                        card.insurance.verification === "office_verified" ? "success" : "neutral"
                      }
                    >
                      {card.insurance.verification === "office_verified"
                        ? t("idCard.insuranceVerified", "Checked by a labour office")
                        : t("idCard.insuranceDeclared", "Declared by worker · not verified")}
                    </Badge>
                  </dd>
                ) : (
                  <dd className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("idCard.noInsurance", "No cover on record")}
                  </dd>
                )}
              </div>
            </dl>

            <div className="border-t border-gray-100 px-4 py-2.5 dark:border-gray-800">
              <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                {t(
                  "idCard.footer",
                  "This card confirms a registration accepted by a labour office. It is not a background check. Anyone can verify it by scanning the QR code.",
                )}
              </p>
            </div>
          </div>

          <div className="mt-5 print:hidden">
            <Button onClick={() => window.print()} className="w-full" disabled={loading}>
              <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("idCard.print", "Print / Save as PDF")}
            </Button>{" "}
            {verifyUrl && (
              <p className="mt-3 break-all text-center text-[11px] text-gray-400">{verifyUrl}</p>
            )}
          </div>

          <InsurancePanel data={insurance} onChanged={() => setReloadKey((k) => k + 1)} />
        </>
      )}
    </Screen>
  );
}
