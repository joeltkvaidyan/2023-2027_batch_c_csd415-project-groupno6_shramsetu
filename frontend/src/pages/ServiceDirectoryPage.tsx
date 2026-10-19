import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, ShieldCheck, AlertTriangle, Info } from "lucide-react";
import { Screen } from "../components/Screen";
import { Card, Badge } from "../components/ui";

interface VerifiedEntry {
  id: string;
  category: string;
  jurisdiction: string;
  title: string;
  status: string;
  verified_at: string;
  notes: string;
  url: string;
}

interface Registry {
  entries: VerifiedEntry[];
  excluded_claims?: Array<{ claim: string; reason: string }>;
}

const StatusIcon = ({ status }: { status: string }) => {
  if (status === "verified") return <ShieldCheck className="h-4 w-4 text-green-600" />;
  if (status === "unverified") return <AlertTriangle className="h-4 w-4 text-red-600" />;
  if (status === "superseded") return <AlertTriangle className="h-4 w-4 text-orange-600" />;
  if (status === "uncertain") return <Info className="h-4 w-4 text-yellow-600" />;
  return <Info className="h-4 w-4 text-gray-600" />;
};

const StatusTone = (status: string) => {
  if (status === "verified") return "success";
  if (status === "unverified") return "danger";
  if (status === "superseded") return "warning";
  if (status === "uncertain") return "warning";
  return "neutral";
};

export default function ServiceDirectoryPage() {
  const { t } = useTranslation();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/verified-sources.json")
      .then((r) => r.json())
      .then((data) => {
        setRegistry(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Screen title={t("services.title", "Verified Services Directory")} onBack={true}>
        <div className="p-4">{t("common.loading", "Loading...")}</div>
      </Screen>
    );
  }

  if (!registry) {
    return (
      <Screen title={t("services.title", "Verified Services Directory")} onBack={true}>
        <div className="p-4">{t("common.error", "Error loading directory")}</div>
      </Screen>
    );
  }

  const categories = Array.from(new Set(registry.entries.map((e) => e.category))).sort();
  const filtered = filter === "all" 
    ? registry.entries 
    : registry.entries.filter((e) => e.category === filter);

  return (
    <Screen title={t("services.title", "Verified Services Directory")} onBack={true}>
      <div className="space-y-4 mt-4 pb-10 px-4">
        <Card className="!p-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilter("all")} className="cursor-pointer">
              <Badge 
                tone={filter === "all" ? "brand" : "neutral"}
              >
                All
              </Badge>
            </button>
            {categories.map((c) => (
              <button key={c} onClick={() => setFilter(c)} className="cursor-pointer">
                <Badge
                  tone={filter === c ? "brand" : "neutral"}
                  className="capitalize"
                >
                  {c}
                </Badge>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          {filtered.map((entry) => (
            <Card key={entry.id} className="!p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex-1">
                  {entry.title}
                </h3>
                <Badge tone={StatusTone(entry.status) as any}>
                  <StatusIcon status={entry.status} />
                  <span className="ml-1 capitalize">{entry.status}</span>
                </Badge>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1 mb-3">
                <div>Category: <span className="capitalize">{entry.category}</span></div>
                <div>Jurisdiction: {entry.jurisdiction}</div>
                <div>Verified: {entry.verified_at}</div>
              </div>
              {entry.notes && (
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">{entry.notes}</p>
              )}
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
              >
                Official source <ExternalLink className="h-3 w-3" />
              </a>
            </Card>
          ))}
        </div>
      </div>
    </Screen>
  );
}
