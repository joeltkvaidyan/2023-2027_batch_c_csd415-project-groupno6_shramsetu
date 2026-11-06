import { Navigate, Route, Routes } from "react-router-dom";
import { getGovToken } from "./api/client";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Pages are statically imported on purpose. They used to be React.lazy chunks
// behind a full-screen "Loading…" fallback, so every navigation showed a
// spinner while a chunk downloaded. The whole app is one bundle now: navigation
// is synchronous and there is no loading display between routes.
import LanguageSelectPage from "./pages/LanguageSelectPage";
import StakeholderSelectPage from "./pages/StakeholderSelectPage";
import WorkerLoginPage from "./pages/WorkerLoginPage";
import WorkerRegisterPage from "./pages/WorkerRegisterPage";
import WorkerDashboardPage from "./pages/WorkerDashboardPage";
import DocumentWalletPage from "./pages/DocumentWalletPage";
import ChatbotPage from "./pages/ChatbotPage";
import SettingsPage from "./pages/SettingsPage";
import GrievanceListPage from "./pages/GrievanceListPage";
import GrievanceFormPage from "./pages/GrievanceFormPage";
import GrievanceDetailPage from "./pages/GrievanceDetailPage";
import WageLogPage from "./pages/WageLogPage";
import GovernmentLoginPage from "./pages/GovernmentLoginPage";
import NotificationInboxPage from "./pages/NotificationInboxPage";
import GovernmentDashboardPage from "./pages/GovernmentDashboardPage";
import ServiceDirectoryPage from "./pages/ServiceDirectoryPage";
import ScamCheckerPage from "./pages/ScamCheckerPage";
import JobsPage from "./pages/JobsPage";
import EmployersPage from "./pages/EmployersPage";
import AccountRecoveryPage from "./pages/AccountRecoveryPage";
import EmployerLoginPage from "./pages/EmployerLoginPage";
import EmployerRegisterPage from "./pages/EmployerRegisterPage";
import EmployerDashboardPage from "./pages/EmployerDashboardPage";
import CitizenLoginPage from "./pages/CitizenLoginPage";
import CitizenDashboardPage from "./pages/CitizenDashboardPage";
import WorkerRequestsPage from "./pages/WorkerRequestsPage";

function GovernmentRoute({ children }: { children: React.ReactNode }) {
  const token = getGovToken();
  if (!token) return <Navigate to="/government/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LanguageSelectPage />} />
        <Route path="/language" element={<LanguageSelectPage />} />
        <Route path="/roles" element={<StakeholderSelectPage />} />

        {/* Worker routes */}
        <Route path="/worker/login" element={<WorkerLoginPage />} />
        <Route path="/worker/register" element={<WorkerRegisterPage />} />
        <Route path="/worker/recover" element={<AccountRecoveryPage />} />
        <Route
          path="/worker/dashboard"
          element={
            <ProtectedRoute>
              <WorkerDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/documents"
          element={
            <ProtectedRoute>
              <DocumentWalletPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/chat"
          element={
            <ProtectedRoute>
              <ChatbotPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/wages"
          element={
            <ProtectedRoute>
              <WageLogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/grievances"
          element={
            <ProtectedRoute>
              <GrievanceListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/grievances/new"
          element={
            <ProtectedRoute>
              <GrievanceFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/grievances/:id"
          element={
            <ProtectedRoute>
              <GrievanceDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/notifications"
          element={
            <ProtectedRoute>
              <NotificationInboxPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/services"
          element={
            <ProtectedRoute>
              <ServiceDirectoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/scam-checker"
          element={
            <ProtectedRoute>
              <ScamCheckerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/jobs"
          element={
            <ProtectedRoute>
              <JobsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/employers"
          element={
            <ProtectedRoute>
              <EmployersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/worker/requests"
          element={
            <ProtectedRoute>
              <WorkerRequestsPage />
            </ProtectedRoute>
          }
        />

        {/* Employer routes — separate token store from worker/government.
          The dashboard itself redirects to /employer/login without a token and
          refreshes its labour-office acceptance state from the server. */}
        <Route path="/employer/login" element={<EmployerLoginPage />} />
        <Route path="/employer/register" element={<EmployerRegisterPage />} />
        <Route path="/employer/dashboard" element={<EmployerDashboardPage />} />

        {/* Citizen (household) routes — separate token store */}
        <Route path="/citizen/login" element={<CitizenLoginPage />} />
        <Route path="/citizen/dashboard" element={<CitizenDashboardPage />} />

        {/* The open directory is gone: worker contact numbers are shown only
          to a signed-in employer/household account. Old links land on the
          role picker, where those accounts can sign in. */}
        <Route path="/find-workers" element={<Navigate to="/roles" replace />} />

        {/* Government routes — completely separate */}
        <Route path="/government/login" element={<GovernmentLoginPage />} />
        <Route
          path="/government/dashboard"
          element={
            <GovernmentRoute>
              <GovernmentDashboardPage />
            </GovernmentRoute>
          }
        />
        <Route path="/government/*" element={<Navigate to="/government/dashboard" replace />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
