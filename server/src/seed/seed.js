import { User } from "../models/User.js";
import { Grievance } from "../models/Grievance.js";
import { JobPosting } from "../models/JobPosting.js";
import { PushNotification, WorkerNotification } from "../models/Notification.js";
import { hashPassword } from "../utils/crypto.js";

export const DEMO_WORKER_PW = "Worker@123";

/**
 * The hiring side of the demo — the account that signs in, searches workers
 * and calls them directly from the employer dashboard.
 *   Employer: 9000000021 / Employer@123
 *   Household: 9000000022 / Household@123
 * Both are created already labour-office accepted, so the dashboard opens
 * with posting and rating unlocked instead of a review banner.
 */
export const DEMO_EMPLOYER = {
  mobile: "9000000021",
  password: "Employer@123",
  full_name: "Ravi Menon",
  business_name: "SK Constructions",
  state: "Kerala",
  district: "Ernakulam",
  city: "Kakkanad",
};

export const DEMO_CITIZEN = {
  mobile: "9000000022",
  password: "Household@123",
  full_name: "Valsa Thomas",
  state: "Kerala",
  district: "Ernakulam",
  city: "Kakkanad",
};

/**
 * Scoped government officials for the demo (create-only, never overwritten).
 * Login: POST /api/v1/auth/government/login { employee_id, password }.
 *   KL001  / Kerala@123     → state-level official  (sees ALL Kerala)
 *   EKM001 / Ernakulam@123  → district official     (sees ONLY Ernakulam)
 *   ADMIN001 (bootstrap)    → superadmin            (sees everything)
 * Workers outside the official's jurisdiction are invisible to them, and
 * notification targets outside it are rejected with 403.
 */
export const DEMO_OFFICIALS = [
  {
    employee_id: "KL001",
    password: "Kerala@123",
    full_name: "Kerala State Labour Officer",
    designation: "State Labour Commissioner",
    department: "Labour Department",
    state: "Kerala",
    district: null,
    mobile_number: "9000000011",
  },
  {
    employee_id: "EKM001",
    password: "Ernakulam@123",
    full_name: "Ernakulam District Labour Officer",
    designation: "District Labour Officer",
    department: "Labour Department",
    state: "Kerala",
    district: "Ernakulam",
    mobile_number: "9000000012",
  },
];

/** Idempotent official seeding — create-only, safe to call on every boot. */
export async function seedOfficials() {
  for (const o of DEMO_OFFICIALS) {
    const existing = await User.findOne({ role: "government", employee_id: o.employee_id });
    if (existing) continue;
    await User.create({
      role: "government",
      employee_id: o.employee_id,
      full_name: o.full_name,
      mobile_number: o.mobile_number,
      email: null,
      password_hash: await hashPassword(o.password),
      department: o.department,
      designation: o.designation,
      state: o.state,
      district: o.district,
      is_superadmin: false,
      is_active: true,
    });
    console.log(`[seed] official created: ${o.employee_id} (${o.state}${o.district ? " / " + o.district : ""})`);
  }
}

const WORKERS = [
  { name: "Ramesh Kumar", mobile: "9555500101", gender: "male", occupation: "construction", state: "Kerala", district: "Ernakulam", city: "Kochi", nativeState: "West Bengal", nativeDistrict: "Murshidabad", lang: "hi", exp: 8 },
  { name: "Sunita Devi", mobile: "9555500102", gender: "female", occupation: "domestic_work", state: "Kerala", district: "Ernakulam", city: "Kakkanad", nativeState: "Jharkhand", nativeDistrict: "Ranchi", lang: "hi", exp: 5 },
  { name: "Md. Imran Sheikh", mobile: "9555500103", gender: "male", occupation: "textile_garment", state: "Kerala", district: "Kozhikode", city: "Kozhikode", nativeState: "West Bengal", nativeDistrict: "Nadia", lang: "bn", exp: 6 },
  { name: "Lakshmi Narayanan", mobile: "9555500104", gender: "female", occupation: "agriculture", state: "Kerala", district: "Palakkad", city: "Palakkad", nativeState: "Tamil Nadu", nativeDistrict: "Coimbatore", lang: "ta", exp: 12 },
  { name: "Rahul Verma", mobile: "9555500105", gender: "male", occupation: "driver_transport", state: "Kerala", district: "Thiruvananthapuram", city: "Thiruvananthapuram", nativeState: "Uttar Pradesh", nativeDistrict: "Varanasi", lang: "hi", exp: 4 },
  { name: "Anjali Kumari", mobile: "9555500106", gender: "female", occupation: "hospitality", state: "Kerala", district: "Ernakulam", city: "Fort Kochi", nativeState: "Bihar", nativeDistrict: "Patna", lang: "hi", exp: 3 },
  { name: "Karthik Rajan", mobile: "9555500107", gender: "male", occupation: "factory_worker", state: "Tamil Nadu", district: "Coimbatore", city: "Coimbatore", nativeState: "Tamil Nadu", nativeDistrict: "Madurai", lang: "ta", exp: 9 },
  { name: "Priya Chatterjee", mobile: "9555500108", gender: "female", occupation: "security_guard", state: "Kerala", district: "Thiruvananthapuram", city: "Kazhakootam", nativeState: "West Bengal", nativeDistrict: "Kolkata", lang: "bn", exp: 2 },
  { name: "Suresh Yadav", mobile: "9555500109", gender: "male", occupation: "street_vendor", state: "Kerala", district: "Thrissur", city: "Thrissur", nativeState: "Uttar Pradesh", nativeDistrict: "Lucknow", lang: "hi", exp: 7 },
  { name: "Meena Kumari", mobile: "9555500110", gender: "female", occupation: "construction", state: "Tamil Nadu", district: "Coimbatore", city: "Saravanampatti", nativeState: "Rajasthan", nativeDistrict: "Jaipur", lang: "hi", exp: 1 },
];

const GRIEVANCES = [
  { mobile: "9555500101", category: "unpaid_wages", subject: "Two months' wages withheld", description: "Contractor at the Kakkanad site has not paid wages since June. Site supervisor keeps promising payment every Friday.", status: "under_review", priority: "high", employer: "SK Constructions", location: "Kakkanad, Kochi", days: 21 },
  { mobile: "9555500101", category: "workplace_safety", subject: "No safety harness on scaffolding", description: "We work on the 6th floor with no safety harnesses or nets provided.", status: "submitted", priority: "urgent", employer: "SK Constructions", location: "Kakkanad, Kochi", days: 3 },
  { mobile: "9555500102", category: "employer_dispute", subject: "Passport held by employer", description: "Madam keeps my passport saying I will run away. I want it back to renew my e-Shram registration.", status: "under_review", priority: "high", employer: "Private household", location: "Kakkanad, Kochi", days: 12 },
  { mobile: "9555500103", category: "accommodation", subject: "Overflowing shared toilet in labour camp", description: "Twelve of us share one toilet which has been blocked for a week. Health risk for everyone in the camp.", status: "submitted", priority: "medium", employer: "TexWeave Garments", location: "Kozhikode camp", days: 6 },
  { mobile: "9555500104", category: "unpaid_wages", subject: "Wage below agreed rate", description: "I was promised 700 rupees per day for harvesting but receive only 450.", status: "resolved", priority: "medium", employer: "Green Fields Estate", location: "Palakkad", days: 45 },
  { mobile: "9555500105", category: "document_issue", subject: "Driving licence renewal stuck", description: "My UP driving licence expired and the RTO here says I need local address proof which my landlord will not give.", status: "submitted", priority: "low", employer: "", location: "Thiruvananthapuram", days: 9 },
  { mobile: "9555500106", category: "harassment_abuse", subject: "Verbal abuse by shift manager", description: "The shift manager shouts and insults us in front of guests when we make small mistakes.", status: "under_review", priority: "high", employer: "Cochin Grand Hotel", location: "Fort Kochi", days: 15 },
  { mobile: "9555500107", category: "insurance_claim", subject: "ESIC claim rejected without reason", description: "I hurt my hand on the machine in March. The ESIC claim was rejected but nobody told me why.", status: "submitted", priority: "medium", employer: "Precision Tools Ltd", location: "Coimbatore", days: 30 },
  { mobile: "9555500108", category: "workplace_safety", subject: "No fire exit in ladies hostel", description: "The hostel where 40 of us live has one locked gate and no fire extinguisher anywhere.", status: "resolved", priority: "urgent", employer: "SecureWatch Services", location: "Kazhakootam", days: 60 },
  { mobile: "9555500109", category: "other", subject: "Police asking for weekly payment", description: "Local police constable collects 200 rupees from street vendors every week near the temple road.", status: "submitted", priority: "high", employer: "", location: "Thrissur", days: 5 },
  { mobile: "9555500110", category: "illegal_termination", subject: "Fired without notice after injury", description: "Site engineer removed me from work after my hand injury saying I am now 'slow'. No notice, no compensation.", status: "under_review", priority: "urgent", employer: "BlueSky Builders", location: "Saravanampatti", days: 8 },
];

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const SLA_DAYS = { urgent: 7, high: 14, medium: 30, low: 45 };

async function seedDirectoryAccounts() {
  const employer = await User.findOne({ role: "employer", mobile_number: DEMO_EMPLOYER.mobile });
  if (!employer) {
    await User.create({
      role: "employer",
      full_name: DEMO_EMPLOYER.full_name,
      business_name: DEMO_EMPLOYER.business_name,
      mobile_number: DEMO_EMPLOYER.mobile,
      password_hash: await hashPassword(DEMO_EMPLOYER.password),
      current_village_or_city: DEMO_EMPLOYER.city,
      current_state: DEMO_EMPLOYER.state,
      current_district: DEMO_EMPLOYER.district,
      is_phone_verified: true,
      is_active: true,
      gov_approve_status: "accepted",
      gov_approve_at: new Date(),
    });
    console.log(`[seed] employer created: ${DEMO_EMPLOYER.mobile}`);
  } else if (employer.gov_approve_status !== "accepted" || !employer.is_phone_verified) {
    employer.gov_approve_status = "accepted";
    employer.gov_approve_at = employer.gov_approve_at ?? new Date();
    employer.is_phone_verified = true;
    await employer.save();
  }

  const citizen = await User.findOne({ role: "citizen", mobile_number: DEMO_CITIZEN.mobile });
  if (!citizen) {
    await User.create({
      role: "citizen",
      full_name: DEMO_CITIZEN.full_name,
      mobile_number: DEMO_CITIZEN.mobile,
      password_hash: await hashPassword(DEMO_CITIZEN.password),
      current_village_or_city: DEMO_CITIZEN.city,
      current_state: DEMO_CITIZEN.state,
      current_district: DEMO_CITIZEN.district,
      is_phone_verified: true,
      is_active: true,
      gov_approve_status: "accepted",
    });
    console.log(`[seed] household account created: ${DEMO_CITIZEN.mobile}`);
  } else if (!citizen.is_phone_verified) {
    citizen.is_phone_verified = true;
    await citizen.save();
  }

  // One open listing so the demo employer dashboard has live content.
  const owner = await User.findOne({ role: "employer", mobile_number: DEMO_EMPLOYER.mobile });
  if (owner && (await JobPosting.countDocuments({ posted_by: owner._id })) === 0) {
    await JobPosting.create({
      title: "Mason helper needed at Kakkanad site",
      description:
        "Six-storey apartment site in Kakkanad. Help the mason with block work and mixing. Wages paid every Friday; safety helmet and gloves provided.",
      employer_name: DEMO_EMPLOYER.business_name,
      occupation: "construction",
      state: DEMO_EMPLOYER.state,
      district: DEMO_EMPLOYER.district,
      work_location: "Kakkanad, Kochi",
      wage_min: 700,
      wage_max: 850,
      wage_period: "day",
      work_type: "daily",
      openings: 4,
      contact_phone: DEMO_EMPLOYER.mobile,
      status: "open",
      posted_by: owner._id,
      posted_by_role: "employer",
      employer_id: owner._id,
      employer_accepted: true,
    });
    console.log("[seed] demo employer listing created");
  }
}

export async function seedDemoData() {
  // Officials first (they are also the senders of the welcome broadcast),
  // then the worker/grievance corpus unless it already exists.
  await seedOfficials();
  await seedDirectoryAccounts();

  // Create-only PER WORKER: a partial corpus (say 9 of 10 after a stray
  // deletion) must neither re-create the others — duplicating accounts —
  // nor skip the missing one because the total fell below 10.
  console.log("[seed] ensuring 10 demo workers + grievances + notifications…");
  const mobileToWorker = new Map();

  for (const w of WORKERS) {
    const existingUser = await User.findOne({ role: "worker", mobile_number: w.mobile });
    if (existingUser) {
      mobileToWorker.set(w.mobile, existingUser);
      continue;
    }
    const user = await User.create({
      worker_id: `SS-${100001 + (Number(w.mobile.slice(-2)) - 1)}`,
      role: "worker",
      full_name: w.name,
      mobile_number: w.mobile,
      email: `worker${w.mobile.slice(-4)}@shramsetu.demo`,
      password_hash: await hashPassword(DEMO_WORKER_PW),
      gender: w.gender,
      occupation: w.occupation,
      preferred_language: w.lang,
      current_state: w.state,
      current_district: w.district,
      current_village_or_city: w.city,
      current_address_line: `${w.city} labour area`,
      current_pincode: "682001",
      native_state: w.nativeState,
      native_district: w.nativeDistrict,
      years_of_experience: w.exp,
      emergency_contact_name: "Family member",
      emergency_contact_relation: "spouse",
      emergency_contact_number: "9555599" + w.mobile.slice(-2),
      is_phone_verified: true,
      is_active: true,
      // Demo acceptance mix: most workers are accepted; the last signed-up one
      // stays pending so the government acceptance queue has live content.
      gov_approve_status: "accepted",
    });
    mobileToWorker.set(w.mobile, user);
  }

  // Demo acceptance mix, written as an explicit status pass so it stays
  // idempotent across partial re-seeds: nine accepted, the newest worker
  // (Meena, the last mobile) pending so the government acceptance queue has
  // live content.
  const pendingMobile = WORKERS[WORKERS.length - 1].mobile;
  for (const w of WORKERS) {
    const user = mobileToWorker.get(w.mobile);
    if (!user) continue;
    const status = w.mobile === pendingMobile ? "pending" : "accepted";
    if (user.gov_approve_status !== status || (status === "accepted" && !user.gov_approve_at)) {
      user.gov_approve_status = status;
      user.gov_approve_at = status === "accepted" ? (user.gov_approve_at ?? new Date()) : null;
      await user.save();
    }
  }

  // Grievances + welcome broadcast ride along with the corpus: seed them
  // only when none exist, so a re-run with partial workers can't duplicate
  // complaint history or re-broadcast to inboxes that already have it.
  if ((await Grievance.countDocuments({})) > 0) {
    console.log("[seed] grievance corpus already present — skipping.");
    return;
  }

  for (const g of GRIEVANCES) {
    const owner = mobileToWorker.get(g.mobile);
    const created = daysAgo(g.days);
    await Grievance.create({
      owner_id: owner._id,
      // Denormalised filing jurisdiction: officials are scoped by where the
      // grievance was filed, even if the worker later moves districts.
      owner_state: owner.current_state,
      owner_district: owner.current_district,
      complaint_number: `GR-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
      category: g.category,
      subject: g.subject,
      description: g.description,
      status: g.status,
      priority: g.priority,
      employer_name: g.employer || null,
      incident_location: g.location || null,
      incident_date: created,
      sla_deadline: new Date(created.getTime() + (SLA_DAYS[g.priority] ?? 30) * 86400000),
      resolved_at: g.status === "resolved" ? daysAgo(g.days - 10) : null,
      attachments: [],
      timeline: [
        { status: "submitted", note: null, changed_by: "Worker", created_at: created },
        ...(g.status !== "submitted"
          ? [{ status: g.status, note: null, changed_by: "Labour Department", created_at: daysAgo(Math.max(g.days - 5, 1)) }]
          : []),
      ],
      comments: [],
    });
  }

  // A welcome broadcast so every inbox is non-empty from first boot.
  const admin = await User.findOne({ role: "government", employee_id: "ADMIN001" });
  const broadcast = await PushNotification.create({
    title: "Welcome to ShramSetu",
    body: "Register your e-Shram card, file grievances, and ask the AI assistant about welfare schemes — all in your language.",
    priority: "medium",
    target: "all",
    is_broadcast: true,
    sender_id: admin?._id ?? null,
    sender_name: admin?.full_name ?? "ShramSetu Superadmin",
    department: admin?.department ?? "Labour Department",
    sent_count: mobileToWorker.size,
  });
  await WorkerNotification.insertMany(
    [...mobileToWorker.values()].map((w) => ({ notification_id: broadcast._id, worker_id: w._id }))
  );

  console.log(`[seed] done: ${mobileToWorker.size} workers, ${GRIEVANCES.length} grievances, 1 broadcast notification.`);
}
