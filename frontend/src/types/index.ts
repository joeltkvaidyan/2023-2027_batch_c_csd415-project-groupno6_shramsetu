export interface Worker {
  id: number;
  worker_id: string;
  full_name: string;
  mobile_number: string;
  email?: string | null;
  role: string;
  profile_photo_path?: string | null;
  preferred_language: string;
  qr_code?: string | null;
  /** Government acceptance gate state — the dashboard shows one honest badge. */
  gov_approve_status?: "pending" | "accepted" | "rejected";
  recovery_key_set?: boolean;
}

/**
 * One row of the worker directory. The base shape is the privacy-safe public
 * listing; a signed-in employer/household account also receives `phone` from
 * /directory/workers so it can call the worker about work.
 */
export interface PublicWorker {
  id: string;
  worker_code: string;
  full_name: string;
  occupation: string | null;
  years_of_experience: number | null;
  place: string | null;
  current_district: string | null;
  current_state: string | null;
  rating: { average: number | null; count: number };
  gov_accepted: true;
  /** Present only on the signed-in /directory/workers response. */
  phone?: string | null;
}

export interface PublicWorkersResponse {
  total: number;
  page: number;
  page_size: number;
  workers: PublicWorker[];
}

export interface RatingSummary {
  average: number | null;
  count: number;
  latest: {
    id: string;
    rater_role: string;
    rater_display_name: string;
    stars: number;
    comment: string | null;
    created_at: string;
  }[];
}

export interface DocumentItem {
  id: number;
  display_name: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface ChatAnswerSource {
  title: string | null;
  department: string | null;
  authority?: string;
  last_updated?: string | null;
  last_verified?: string;
  version?: string;
  source_url?: string;
  source_file?: string;
  similarity?: number;
}

export interface ChatAnswer {
  answer: string;
  simple_explanation: string;
  source_document: string | null;
  government_department: string | null;
  confidence_score: number;
  confidence_basis?: "retrieval_similarity";
  last_updated_date: string | null;
  grounded: boolean;
  system_error?: boolean;
  sources?: ChatAnswerSource[];
}

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
  language: string;
  created_at: string;
  meta: ChatAnswer | null;
}

export type GrievanceCategory =
  | "unpaid_wages"
  | "workplace_safety"
  | "harassment_abuse"
  | "illegal_termination"
  | "document_issue"
  | "employer_dispute"
  | "insurance_claim"
  | "accommodation"
  | "other";

export type GrievanceStatus = "submitted" | "under_review" | "resolved" | "rejected" | "withdrawn";

export interface Grievance {
  id: number;
  complaint_number: string;
  category: GrievanceCategory;
  subject: string;
  description: string;
  status: GrievanceStatus;
  priority?: string;
  escalated?: boolean;
  sla_deadline?: string | null;
  employer_name?: string | null;
  incident_location?: string | null;
  incident_date?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
}

export interface GrievanceAttachment {
  id: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface GrievanceStatusLogItem {
  status: string;
  note?: string | null;
  changed_by: string;
  created_at: string;
}

export interface GrievanceComment {
  id: number;
  author_name: string;
  author_role: string;
  content: string;
  created_at: string;
}

export interface GrievanceDetail extends Grievance {
  attachments: GrievanceAttachment[];
  timeline: GrievanceStatusLogItem[];
  comments?: GrievanceComment[];
  worker_rating?: number | null;
  worker_feedback?: string | null;
  feedback_at?: string | null;
}

/** One self-reported wage day-sheet row (worker-side). */
export interface WageEntry {
  id: string;
  work_date: string;
  employer_name: string | null;
  agreed_amount: number;
  paid_amount: number;
  payment_status: "paid" | "unpaid" | "partial";
  created_at: string;
  updated_at: string;
}

export interface WageSummary {
  days_logged: number;
  total_agreed: number;
  total_paid: number;
  total_unpaid: number;
  period: string;
}

/**
 * A recurring employer the WORKER saved for themselves. Self-reported: the
 * backend never verifies these details against the employer.
 */
export interface Employer {
  id: string;
  name: string;
  occupation: string | null;
  phone: string | null;
  work_location: string | null;
  district: string | null;
  state: string | null;
  daily_wage: number | null;
  notes: string | null;
  is_active: boolean;
  self_reported: true;
  created_at: string;
  updated_at: string;
  stats: EmployerStats;
}

export interface EmployerStats {
  days_worked: number;
  total_agreed: number;
  total_paid: number;
  total_outstanding: number;
  last_worked_on: string | null;
}

export type JobMatchLevel = "strong" | "good" | "possible";

/** Why a listing surfaced for this worker (translated key suffixes). */
export type JobMatchReason =
  | "occupation_match"
  | "open_to_any_trade"
  | "same_district"
  | "same_state"
  | "same_area" // citizen service requests only
  | "recent_posting"
  | "multiple_openings"
  | "wage_listed"
  | "employer_accepted" // poster account is labour-office accepted (not a listing verification)
  | "different_trade" // applicant-review direction
  | "detail_not_recorded"; // applicant-review direction

/**
 * A job listing published by a government/partner official inside their own
 * jurisdiction. `verification` stays "unverified" — ShramSetu cannot verify
 * that an employer will honour the listed wage.
 */
export interface JobPosting {
  id: string;
  title: string;
  description: string;
  employer_name: string;
  occupation: string;
  state: string;
  district: string | null;
  /** "government" = official posting (legacy); "employer" = gov-accepted employer self-service listing. */
  posted_by_role?: "government" | "employer";
  /** True only when the POSTER was labour-office accepted — never a listing verification. */
  employer_accepted?: boolean;
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
  updated_at: string;
}

export interface JobMatch extends JobPosting {
  match: { score: number; level: JobMatchLevel; reasons: JobMatchReason[] };
  applied: boolean;
  /** "shortlisted" only ever means the office read the application. */
  application_status: "submitted" | "shortlisted" | null;
}

export interface JobApplication {
  id: string;
  job_id: string;
  status: "submitted" | "shortlisted" | "withdrawn";
  note: string | null;
  share_contact: boolean;
  shortlisted?: boolean;
  created_at: string;
  updated_at: string;
  job?: JobPosting;
}
