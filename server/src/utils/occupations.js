/**
 * Occupations shared by worker profiles, recurring employer records and job
 * listings. Keep in sync with frontend/src/components/register/constants.ts.
 * "any" is valid only for a job listing (an employer hiring across trades).
 */
export const OCCUPATIONS = [
  "construction",
  "domestic_work",
  "agriculture",
  "textile_garment",
  "factory_worker",
  "driver_transport",
  "street_vendor",
  "security_guard",
  "hospitality",
  "other",
];

export const JOB_OCCUPATIONS = [...OCCUPATIONS, "any"];

/** Normalised key for matching a free-text employer name across records. */
export function employerKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
