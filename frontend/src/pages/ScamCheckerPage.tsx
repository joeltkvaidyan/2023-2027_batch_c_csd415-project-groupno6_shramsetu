import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle, HelpCircle } from "lucide-react";
import { Screen } from "../components/Screen";
import { Card, Badge } from "../components/ui";
import { Button } from "../components/ui/Button";

interface ChecklistItem {
  id: string;
  question: string;
  risk: "high" | "medium" | "low";
  explanation: string;
}

const CHECKLIST: ChecklistItem[] = [
  {
    id: "fees",
    question: "Are they asking you to pay money (registration, processing, security, or travel fees) to get the job?",
    risk: "high",
    explanation: "Legitimate jobs through official channels (like NCS) should not require payment. Charging fees is a major red flag.",
  },
  {
    id: "contract",
    question: "Do you have a written job offer or employment contract with clear terms (wages, hours, location, duration)?",
    risk: "high",
    explanation: "Without written terms, it's hard to prove your employment if wages aren't paid. Always ask for written documentation.",
  },
  {
    id: "id",
    question: "Are they asking to keep your original ID documents (Aadhaar, passport, etc.) with them?",
    risk: "high",
    explanation: "You should never surrender your original identity documents. Employers can verify with copies in most cases.",
  },
  {
    id: "agent",
    question: "Is the agent/recruiter registered or can they show official credentials? Can you verify the company?",
    risk: "medium",
    explanation: "Verify through official channels like NCS, Labour Department, or the company's official website. Be wary of unregistered intermediaries.",
  },
  {
    id: "address",
    question: "Do you know the exact workplace address and the actual employer's name?",
    risk: "medium",
    explanation: "Knowing the real employer and location helps if you need to file a complaint later.",
  },
  {
    id: "promises",
    question: "Are they making unrealistic promises (very high wages, immediate job, no paperwork)?",
    risk: "medium",
    explanation: "If it sounds too good to be true, be cautious. Verify wages match notified minimum wages for that work.",
  },
];

export default function ScamCheckerPage() {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, boolean | null>>({});
  const [showResult, setShowResult] = useState(false);

  const getRiskScore = () => {
    let high = 0, medium = 0, low = 0;
    for (const item of CHECKLIST) {
      const a = answers[item.id];
      if (a === true) {
        if (item.risk === "high") high++;
        else if (item.risk === "medium") medium++;
        else low++;
      }
    }
    if (high > 0) return { level: "high" as const, color: "text-red-600", bg: "bg-red-50" };
    if (medium >= 2) return { level: "medium" as const, color: "text-orange-600", bg: "bg-orange-50" };
    if (medium >= 1) return { level: "medium" as const, color: "text-orange-600", bg: "bg-orange-50" };
    return { level: "low" as const, color: "text-green-600", bg: "bg-green-50" };
  };

  const risk = getRiskScore();
  const hasAnswers = Object.keys(answers).length === CHECKLIST.length && 
    Object.values(answers).every((a) => a !== null);

  return (
    <Screen title={t("scamChecker.title", "Scam Risk Checker")} onBack={true}>
      <div className="space-y-4 mt-4 pb-10 px-4">
        <Card className="!p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200">
          <div className="flex items-start gap-3">
            <HelpCircle className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <p className="text-sm text-blue-900 dark:text-blue-100">
                This is an <strong>explainable checklist</strong> to help spot common recruitment red flags. 
                It does not provide legal advice. Always verify with official sources.
              </p>
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          {CHECKLIST.map((item) => (
            <Card key={item.id} className="!p-4">
              <div className="space-y-3">
                <p className="font-medium text-gray-900 dark:text-gray-100">{item.question}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={answers[item.id] === true ? "danger" : "secondary"}
                    onClick={() => setAnswers({ ...answers, [item.id]: true })}
                  >
                    Yes
                  </Button>
                  <Button
                    size="sm"
                    variant={answers[item.id] === false ? "primary" : "secondary"}
                    onClick={() => setAnswers({ ...answers, [item.id]: false })}
                  >
                    No
                  </Button>
                  <Button
                    size="sm"
                    variant={answers[item.id] === null ? "ghost" : "secondary"}
                    onClick={() => setAnswers({ ...answers, [item.id]: null })}
                  >
                    Unsure
                  </Button>
                </div>
                {answers[item.id] === true && (
                  <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-2 rounded">
                    <strong>Why this matters:</strong> {item.explanation}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {hasAnswers && (
          <Card className={`!p-4 ${risk.bg}`}>
            <div className="flex items-start gap-3">
              {risk.level === "high" && <AlertTriangle className={`h-5 w-5 ${risk.color} mt-0.5`} />}
              {risk.level === "medium" && <AlertTriangle className={`h-5 w-5 ${risk.color} mt-0.5`} />}
              {risk.level === "low" && <CheckCircle className={`h-5 w-5 ${risk.color} mt-0.5`} />}
              <div className="space-y-2">
                <h3 className={`font-semibold ${risk.color}`}>
                  Risk Level: {risk.level.toUpperCase()}
                </h3>
                <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
                  {risk.level === "high" && (
                    <p>
                      Several high-risk indicators detected. <strong>Do not pay any fees</strong> and verify with official channels 
                      before proceeding. Contact NCS helpline <strong>1514</strong> or your nearest Labour Office.
                    </p>
                  )}
                  {risk.level === "medium" && (
                    <p>
                      Some concerning indicators. Verify details through official sources (NCS 1514, Labour Department) 
                      and get everything in writing before committing.
                    </p>
                  )}
                  {risk.level === "low" && (
                    <p>
                      Fewer red flags detected based on your answers. Still always get terms in writing, verify the employer, 
                      and never pay recruitment fees.
                    </p>
                  )}
                  <p className="text-xs italic">
                    This is informational only, not legal advice. For specific cases, contact your nearest Labour Office or CSC.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Screen>
  );
}
