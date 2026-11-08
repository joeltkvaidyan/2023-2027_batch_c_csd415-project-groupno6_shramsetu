/**
 * Government API client — handles auth, dashboard stats, workers, grievances,
 * notifications, and audit logs. Completely isolated from worker API client.
 *
 * Backend routes:
 *   /api/v1/auth/government/login   — POST login
 *   /api/v1/auth/government/me      — GET current user
 *   /api/v1/government/dashboard/stats — GET dashboard stats
 *   /api/v1/government/workers      — GET workers list
 *   /api/v1/government/grievances   — GET all grievances
 *   /api/v1/government/grievances/:id — GET detail
 *   /api/v1/government/grievances/:id/status — POST update status
 *   /api/v1/government/grievances/:id/comment — POST add comment
 *   /api/v1/government/notifications/send — POST send
 *   /api/v1/government/notifications     — GET list
 *   /api/v1/government/audit-logs        — GET (superadmin)
 */
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";

/**
 * The government session is an httpOnly cookie, so these calls carry no
 * Authorization header and no token argument: `withCredentials` lets the browser
 * attach the cookie, and the API checks the role on the server.
 */
const govApi = axios.create({ baseURL: API_BASE, withCredentials: true });

// ── Government auth ──────────────────────────────────────────────────

export interface GovernmentUser {
  id: number;
  employee_id: string;
  full_name: string;
  email: string;
  mobile_number: string;
  department: string;
  designation: string | null;
  state: string | null;
  district: string | null;
  is_superadmin: boolean;
  created_at: string;
}

export interface GovLoginResponse {
  access_token: string;
  government: GovernmentUser;
}

export async function govLogin(employee_id: string, password: string): Promise<GovLoginResponse> {
  const { data } = await govApi.post(`${API_BASE}/auth/government/login`, {
    employee_id,
    password,
  });
  return data;
}

export async function govGetMe(): Promise<GovernmentUser> {
  const { data } = await govApi.get(`${API_BASE}/auth/government/me`);
  return data;
}

// ── Dashboard stats ──────────────────────────────────────────────────

export interface DashboardStats {
  total_workers: number;
  active_workers: number;
  total_grievances: number;
  open_grievances: number;
  resolved_grievances: number;
  urgent_grievances: number;
  total_employers?: number;
  pending_employers?: number;
  grievances_by_category: Record<string, number>;
  grievances_by_status: Record<string, number>;
  recent_filings: Array<{
    id: number;
    complaint_number: string;
    category: string;
    subject: string;
    status: string;
    created_at: string | null;
  }>;
  workers_by_state: Record<string, number>;
}

export async function govGetStats(): Promise<DashboardStats> {
  const { data } = await govApi.get(`${API_BASE}/government/dashboard/stats`);
  return data;
}

// ── Workers ──────────────────────────────────────────────────────────

export interface WorkerRecord {
  id: number;
  worker_id: string;
  full_name: string;
  occupation: string | null;
  current_state: string | null;
  current_district: string | null;
  is_active: boolean;
  created_at: string | null;
}

export interface WorkersResponse {
  total: number;
  workers: WorkerRecord[];
}

export async function govGetWorkers(search?: string): Promise<WorkersResponse> {
  const params: Record<string, string> = {};
  if (search) params.search = search;
  const { data } = await govApi.get(`${API_BASE}/government/workers`, {
    params,
  });
  return data;
}

// ── Grievances ───────────────────────────────────────────────────────

export interface GovGrievance {
  id: number;
  complaint_number: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  employer_name: string | null;
  incident_location: string | null;
  incident_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
}

export interface GrievancesResponse {
  total: number;
  grievances: GovGrievance[];
}

export async function govGetGrievances(
  statusFilter?: string,
  category?: string,
): Promise<GrievancesResponse> {
  const params: Record<string, string> = {};
  if (statusFilter) params.status_filter = statusFilter;
  if (category) params.category = category;
  const { data } = await govApi.get(`${API_BASE}/government/grievances`, {
    params,
  });
  return data;
}

export interface GovGrievanceDetail {
  id: number;
  complaint_number: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  employer_name: string | null;
  incident_location: string | null;
  incident_date: string | null;
  created_at: string | null;
  worker: {
    worker_id: string | null;
    full_name: string | null;
    occupation: string | null;
    current_state: string | null;
    current_district: string | null;
  };
  comments: Array<{
    id: number;
    author_name: string;
    author_role: string;
    content: string;
    is_internal: boolean;
    created_at: string | null;
  }>;
  timeline: Array<{
    status: string;
    note: string | null;
    changed_by: string;
    created_at: string | null;
  }>;
}

export async function govGetGrievanceDetail(grievanceId: number): Promise<GovGrievanceDetail> {
  const { data } = await govApi.get(`${API_BASE}/government/grievances/${grievanceId}`);
  return data;
}

export async function govUpdateGrievanceStatus(
  grievanceId: number,
  newStatus: string,
  note?: string,
): Promise<{ detail: string; old_status: string; new_status: string }> {
  const { data } = await govApi.post(
    `${API_BASE}/government/grievances/${grievanceId}/status`,
    { status: newStatus, note },
    undefined,
  );
  return data;
}

export async function govAddComment(
  grievanceId: number,
  content: string,
  isInternal: boolean = false,
) {
  const { data } = await govApi.post(
    `${API_BASE}/government/grievances/${grievanceId}/comment`,
    { content, is_internal: isInternal },
    undefined,
  );
  return data;
}

// ── Notifications ────────────────────────────────────────────────────

export interface GovNotification {
  id: number;
  title: string;
  body: string;
  priority: string;
  target: string;
  target_value: string | null;
  sender_name: string;
  department: string;
  is_broadcast: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: GovNotification[];
}

export async function govSendNotification(payload: {
  title: string;
  body: string;
  priority?: string;
  target?: string;
  target_value?: string;
  is_broadcast?: boolean;
}): Promise<{ detail: string; notification_id: number; sent_count: number }> {
  const { data } = await govApi.post(`${API_BASE}/government/notifications/send`, payload, {});
  return data;
}

export async function govGetNotifications(): Promise<NotificationsResponse> {
  const { data } = await govApi.get(`${API_BASE}/government/notifications`);
  return data;
}

// ── Officials directory (superadmin monitoring) ─────────────────────

export interface GovernmentOfficial {
  id: string;
  employee_id: string | null;
  full_name: string;
  department: string | null;
  state: string | null;
  district: string | null;
  is_superadmin: boolean;
  workers_in_scope: number;
  grievances_in_scope: number;
}

export interface OfficialsResponse {
  officials: GovernmentOfficial[];
}

/** Superadmin only — the server answers 403 for any other official. */
export async function govGetOfficials(): Promise<OfficialsResponse> {
  const { data } = await govApi.get(`${API_BASE}/government/officials`);
  return data;
}

// ── Audit Logs (superadmin only) ────────────────────────────────────

export interface AuditLog {
  id: number;
  timestamp: string;
  actor_role: string;
  actor_identifier: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  success: boolean;
  failure_reason: string | null;
}

export interface AuditLogsResponse {
  logs: AuditLog[];
}

export async function govGetAuditLogs(): Promise<AuditLogsResponse> {
  const { data } = await govApi.get(`${API_BASE}/government/audit-logs`);
  return data;
}

// ── Job listings posted by this office ─────────────────────────────
//
// Listings are created by an official inside their own jurisdiction. The
// server rejects out-of-scope postings (403) and never marks a listing as
// verified — ShramSetu cannot verify a third-party employer.

export interface GovJobPosting {
  id: string;
  title: string;
  description: string;
  employer_name: string;
  occupation: string;
  state: string;
  district: string | null;
  work_location: string | null;
  wage_min: number | null;
  wage_max: number | null;
  wage_period: "day" | "week" | "month";
  work_type: "daily" | "part_time" | "full_time" | "seasonal";
  openings: number;
  contact_phone: string | null;
  status: "open" | "closed";
  posted_by_department: string | null;
  verification: "unverified";
  created_at: string;
  applications_count: number;
  shortlisted_count: number;
}

/** Why an applicant's stored profile lines up with this listing. */
export type ApplicantReviewReason =
  | "occupation_match"
  | "open_to_any_trade"
  | "different_trade"
  | "same_district"
  | "same_state"
  | "detail_not_recorded";

export interface GovJobApplicant {
  id: string;
  job_id: string;
  status: "submitted" | "shortlisted" | "withdrawn";
  note: string | null;
  worker: {
    worker_code: string | null;
    full_name: string | null;
    occupation: string | null;
    district: string | null;
    state: string | null;
    /** null unless the worker ticked "share my number" when applying. */
    contact_phone: string | null;
  };
  review: {
    score: number;
    level: "strong" | "good" | "possible";
    reasons: ApplicantReviewReason[];
  };
  shortlisted: boolean;
  reviewed_at: string | null;
  created_at: string;
}

export async function govGetPostedJobs(): Promise<{ jobs: GovJobPosting[] }> {
  const { data } = await govApi.get(`${API_BASE}/jobs/posted`);
  return data;
}

export async function govCreateJob(payload: {
  title: string;
  description: string;
  employer_name: string;
  occupation: string;
  district?: string | null;
  work_location?: string | null;
  wage_min?: number | null;
  wage_max?: number | null;
  wage_period?: string;
  work_type?: string;
  openings?: number;
  contact_phone?: string | null;
}): Promise<GovJobPosting> {
  const { data } = await govApi.post(`${API_BASE}/jobs`, payload, {});
  return data;
}

export async function govSetJobStatus(
  jobId: string,
  status: "open" | "closed",
): Promise<GovJobPosting> {
  const { data } = await govApi.patch(`${API_BASE}/jobs/${jobId}/status`, { status }, undefined);
  return data;
}

export interface JobApplicantsResponse {
  applications: GovJobApplicant[];
  counts: { total: number; shortlisted: number };
  matching_note: string;
}

export async function govGetJobApplicants(jobId: string): Promise<JobApplicantsResponse> {
  const { data } = await govApi.get(`${API_BASE}/jobs/${jobId}/applications`);
  return data;
}

/**
 * Triage mark only: "shortlisted" means this office read the application and
 * wants to follow up. It is never an offer of work, and the worker sees it as
 * exactly that.
 */
export async function govReviewJobApplicant(
  jobId: string,
  applicationId: string,
  status: "submitted" | "shortlisted",
): Promise<GovJobApplicant> {
  const { data } = await govApi.patch(
    `${API_BASE}/jobs/${jobId}/applications/${applicationId}`,
    { status },
    undefined,
  );
  return data;
}
