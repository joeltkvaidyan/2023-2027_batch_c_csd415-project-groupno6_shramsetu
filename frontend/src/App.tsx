import { Navigate, Route, Routes } from "react-router-dom";
import { RoleRoute } from "./components/RoleRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineBanner } from "./components/OfflineBanner";

// Pages are statically imported on purpose. They used to be React.lazy chunks
// behind a full-screen "Loading…" fallback, so every navigation showed a
// spinner while a chunk downloaded. The whole app is one bundle now: navigation
// renders the page immediately, and only a guarded route — which must wait for
// the server to say who you are — shows a skeleton for that round trip.
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
import WorkerIdCardPage from "./pages/WorkerIdCardPage";
import VerifyWorkerPage from "./pages/VerifyWorkerPage";

export default function App() {
  return (
    <ErrorBoundary>
      {/* Above the routes: one strip for the app, shown only when it has
          something to say (offline, or writes still waiting to be sent). */}
      <OfflineBanner />
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LanguageSelectPage />} />
        <Route path="/language" element={<LanguageSelectPage />} />
        <Route path="/roles" element={<StakeholderSelectPage />} />
        {/* Public on purpose: the QR on a printed worker card is scanned by
            employers, inspectors and police who are not signed in. */}
        <Route path="/verify/:code" element={<VerifyWorkerPage />} />

        {/* Worker routes */}
        <Route path="/worker/login" element={<WorkerLoginPage />} />
        <Route path="/worker/register" element={<WorkerRegisterPage />} />
        <Route path="/worker/recover" element={<AccountRecoveryPage />} />
        <Route
          path="/worker/id-card"
          element={
            <RoleRoute role="worker">
              <WorkerIdCardPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/dashboard"
          element={
            <RoleRoute role="worker">
              <WorkerDashboardPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/documents"
          element={
            <RoleRoute role="worker">
              <DocumentWalletPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/chat"
          element={
            <RoleRoute role="worker">
              <ChatbotPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/wages"
          element={
            <RoleRoute role="worker">
              <WageLogPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/grievances"
          element={
            <RoleRoute role="worker">
              <GrievanceListPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/grievances/new"
          element={
            <RoleRoute role="worker">
              <GrievanceFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/grievances/:id"
          element={
            <RoleRoute role="worker">
              <GrievanceDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/notifications"
          element={
            <RoleRoute role="worker">
              <NotificationInboxPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/settings"
          element={
            <RoleRoute role="worker">
              <SettingsPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/services"
          element={
            <RoleRoute role="worker">
              <ServiceDirectoryPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/scam-checker"
          element={
            <RoleRoute role="worker">
              <ScamCheckerPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/jobs"
          element={
            <RoleRoute role="worker">
              <JobsPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/employers"
          element={
            <RoleRoute role="worker">
              <EmployersPage />
            </RoleRoute>
          }
        />
        <Route
          path="/worker/requests"
          element={
            <RoleRoute role="worker">
              <WorkerRequestsPage />
            </RoleRoute>
          }
        />

        {/* Employer routes. RoleRoute asks the server which role the session is,
          so a worker cannot open this dashboard and an employer who reloads
          here is not bounced by a forgotten client flag. */}
        <Route path="/employer/login" element={<EmployerLoginPage />} />
        <Route path="/employer/register" element={<EmployerRegisterPage />} />
        <Route
          path="/employer/dashboard"
          element={
            <RoleRoute role="employer">
              <EmployerDashboardPage />
            </RoleRoute>
          }
        />

        {/* Citizen (household) routes */}
        <Route path="/citizen/login" element={<CitizenLoginPage />} />
        <Route
          path="/citizen/dashboard"
          element={
            <RoleRoute role="citizen">
              <CitizenDashboardPage />
            </RoleRoute>
          }
        />

        {/* The open directory is gone: worker contact numbers are shown only
          to a signed-in employer/household account. Old links land on the
          role picker, where those accounts can sign in. */}
        <Route path="/find-workers" element={<Navigate to="/roles" replace />} />

        {/* Government routes */}
        <Route path="/government/login" element={<GovernmentLoginPage />} />
        <Route
          path="/government/dashboard"
          element={
            <RoleRoute role="government">
              <GovernmentDashboardPage />
            </RoleRoute>
          }
        />
        <Route path="/government/*" element={<Navigate to="/government/dashboard" replace />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
