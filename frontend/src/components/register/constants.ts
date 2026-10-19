/**
 * Shared types, lists and helpers for the worker registration wizard.
 * Extracted verbatim from WorkerRegisterPage (behaviour unchanged).
 */

export interface RegistrationFormData {
  // Step 1: Basic Info
  fullName: string;
  mobileNumber: string;
  email: string;
  password: string;
  photo: File | null;
  photoPreview: string | null;

  // Step 2: Personal Details
  dateOfBirth: string;
  gender: string;
  aadhaarNumber: string;

  // Step 3: Current Address
  currentAddressLine: string;
  currentVillageOrCity: string;
  currentDistrict: string;
  currentState: string;
  currentPincode: string;

  // Step 4: Native Address
  nativeState: string;
  nativeDistrict: string;

  // Step 5: Occupation
  occupation: string;
  yearsOfExperience: string;

  // Step 6: Emergency Contact
  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactNumber: string;

  // Privacy consent (required on the final step)
  consentAiProcessing: boolean;
}

export interface RegistrationResponse {
  worker_id: string;
  mobile_number: string;
}

export const STEPS = [
  "stepBasicInfo",
  "stepPersonalDetails",
  "stepAddress",
  "stepOccupation",
  "stepEmergency"
];

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

/**
 * i18n keys for each occupation code. The wizard's labels
 * (auth.occupationConstruction, …) predate the codes, so job/employer screens
 * must map through this table rather than deriving keys from the code —
 * "domestic_work" would otherwise look up auth.occupationDomesticWork and
 * render a raw code.
 */
export const OCCUPATION_LABEL_KEYS: Record<string, string> = {
  construction: "auth.occupationConstruction",
  domestic_work: "auth.occupationDomestic",
  agriculture: "auth.occupationAgriculture",
  textile_garment: "auth.occupationTextile",
  factory_worker: "auth.occupationFactory",
  driver_transport: "auth.occupationDriver",
  street_vendor: "auth.occupationVendor",
  security_guard: "auth.occupationSecurity",
  hospitality: "auth.occupationHospitality",
  other: "auth.occupationOther",
};

/** Translation key for an occupation code (falls back to the code itself). */
export function occupationLabelKey(code: string | null | undefined): string {
  if (!code) return "";
  return OCCUPATION_LABEL_KEYS[code] ?? code;
}

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

export const EMPTY_FORM: RegistrationFormData = {
  fullName: "",
  mobileNumber: "",
  email: "",
  password: "",
  photo: null,
  photoPreview: null,
  dateOfBirth: "",
  gender: "",
  aadhaarNumber: "",
  currentAddressLine: "",
  currentVillageOrCity: "",
  currentDistrict: "",
  currentState: "",
  currentPincode: "",
  nativeState: "",
  nativeDistrict: "",
  occupation: "",
  yearsOfExperience: "",
  emergencyContactName: "",
  emergencyContactRelation: "",
  emergencyContactNumber: "",
  consentAiProcessing: false,
};

/** Field class with error highlight, shared by all register steps. */
export const fieldClass = (fieldErrors: Record<string, string>, field: string) =>
  `input-field${fieldErrors[field] ? " input-error" : ""}`;

/** Props every register step receives from the wizard page. */
export interface RegisterStepProps {
  formData: RegistrationFormData;
  fieldErrors: Record<string, string>;
  onChange: (field: keyof RegistrationFormData, value: string | boolean) => void;
}
