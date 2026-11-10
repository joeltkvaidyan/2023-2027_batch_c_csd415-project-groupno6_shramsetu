/**
 * Insurance records — the worker's own policies, and the labour office's
 * verification queue.
 *
 * Two clients live here on purpose, side by side, because the two sides of this
 * feature must never be confused: a worker declares cover, an official verifies
 * it, and everyone else only ever sees the derived summary on the ID card's
 * public verify page (which comes back through /public/verify/worker/:code, not
 * from anything here).
 */
import axios, { type AxiosInstance } from "axios";
import { attachSession } from "./session";
import { api } from "./client";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";

const govApi: AxiosInstance = attachSession(axios.create({ baseURL: API_BASE }));

export type CoverageType = "accident" | "hospitalisation" | "disability" | "death";
export type PolicyStatus = "active" | "expired" | "upcoming";
export type Verification = "self_declared" | "office_verified";

export interface OwnPolicy {
  id: string;
  provider: string;
  policy_number: string;
  coverage: CoverageType;
  sum_insured: number | null;
  valid_from: string | null;
  valid_to: string | null;
  verification: Verification;
  verified_at: string | null;
  status: PolicyStatus;
}

export interface OwnInsurance {
  policies: OwnPolicy[];
  current: OwnPolicy | null;
}

export interface NewPolicy {
  provider: string;
  policy_number: string;
  coverage: CoverageType;
  sum_insured: number;
  valid_from: string;
  valid_to: string;
}

/** The worker's own records, including the full policy number they typed. */
export async function getMyInsurance(): Promise<OwnInsurance> {
  const res = await api.get<OwnInsurance>("/insurance");
  return res.data;
}

export async function addMyPolicy(policy: NewPolicy): Promise<OwnPolicy> {
  const res = await api.post<{ policy: OwnPolicy }>("/insurance", policy);
  return res.data.policy;
}

export async function removeMyPolicy(id: string): Promise<void> {
  await api.delete(`/insurance/${encodeURIComponent(id)}`);
}

// ── Labour office ────────────────────────────────────────────────────

export interface OfficePolicy {
  id: string;
  worker: {
    id: string;
    worker_id: string | null;
    full_name: string | null;
    district: string | null;
    state: string | null;
  } | null;
  provider: string;
  policy_number: string;
  coverage: CoverageType;
  sum_insured: number | null;
  valid_from: string | null;
  valid_to: string | null;
  verification: Verification;
  verified_at: string | null;
  status: PolicyStatus;
  masked_number: string;
}

export async function govListInsurance(
  params: { verification?: Verification; status?: PolicyStatus } = {},
): Promise<OfficePolicy[]> {
  const res = await govApi.get<{ policies: OfficePolicy[]; count: number }>(
    "/government/insurance",
    {
      params,
    },
  );
  return res.data.policies;
}

export async function govVerifyInsurance(id: string): Promise<OfficePolicy> {
  const res = await govApi.post<{ policy: OfficePolicy }>(
    `/government/insurance/${encodeURIComponent(id)}/verify`,
  );
  return res.data.policy;
}
