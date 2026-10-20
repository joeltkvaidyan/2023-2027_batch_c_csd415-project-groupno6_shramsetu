/** Live smoke test of the Phase-3 features against the RUNNING stack
 * (recovery key, government acceptance, employer + public ratings, the
 * public find-a-worker directory, and job-match scoring) — the complement of
 * verify.mjs, which covers the pre-existing features.
 *
 * verify.mjs asserts exact seeded counts (total_workers === 10), so this
 * script deletes every row it creates, strictly by the _ids it observed —
 * never by worker_id string, which can coincide with a seeded account.
 * It also needs the OTPs the API prints to server/logs/otp-dev.log.
 *
 * Run: node server/scripts/smoke-new-features.mjs   (API on :8000, Mongo on :27017)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const B = "http://127.0.0.1:8000/api/v1";
const otpLog = fileURLToPath(new URL("../logs/otp-dev.log", import.meta.url));
const J = { "Content-Type": "application/json" };
const results = [];
const check = (name, ok, extra = "") => results.push([ok ? "PASS" : "FAIL", name, extra]);

const readOtpLog = () => { try { return readFileSync(otpLog, "utf8"); } catch { return ""; } };
// The OTP is written DURING the request that triggers it, so the log must be
// snapshotted BEFORE the request and diffed AFTER — snapshotting after the
// fact diffs an empty string against itself.
const otpMark = () => readOtpLog();
async function otpSince(mobile, mark) {
  await new Promise((r) => setTimeout(r, 300));
  const after = readOtpLog();
  const lines = after.slice(mark.length).split("\n").filter((l) => l.includes(`+91 ${mobile}`));
  return lines.join("\n").match(/OTP (\d{6})/)?.[1] || "";
}

const rnd = () => String(Date.now() % 100000000).padStart(8, "0");
const W_MOBILE = `98${rnd()}`.slice(0, 10);
const E_MOBILE = `97${rnd()}`.slice(0, 10);
const NEW_MOBILE = `96${rnd()}`.slice(0, 10);
const PUB_PHONE = `95${rnd()}`.slice(0, 10);
const JOB_TITLE = `Smoke job ${rnd()}`;
const PASS = "Smoke@123";
const NEW_PASS = "NewPass@456";

let workerIdCode = "";   // SS-1000xxx
let workerOid = "";      // Mongo _id
let employerOid = "";    // Mongo _id
let employerToken = "";
let jobOid = "";

try {
  // ── 1. Worker registration → recovery key returned ONCE ──────────────
  let mark = otpMark();
  let r = await fetch(`${B}/auth/worker/register`, {
    method: "POST", headers: J,
    body: JSON.stringify({
      mobile_number: W_MOBILE, full_name: "Smoke Tester", password: PASS,
      occupation: "construction", years_of_experience: "3",
      current_state: "Kerala", current_district: "Ernakulam",
      current_village_or_city: "Kakkanad", preferred_language: "en",
    }),
  });
  const reg = await r.json();
  check("register → 201 + one-time recovery key (SRK-…)", r.status === 201 && /^SRK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reg.recovery_key || ""), JSON.stringify(reg));
  workerIdCode = reg.worker_id;

  // ── 2. OTP verify → JWT, status pending ──────────────────────────────
  let otp = await otpSince(W_MOBILE, mark);
  check("register OTP printed in backend terminal", Boolean(otp));
  r = await fetch(`${B}/auth/worker/otp/verify`, { method: "POST", headers: J, body: JSON.stringify({ mobile_number: W_MOBILE, otp }) });
  const verified = await r.json();
  check("otp verify → JWT + gov_approve_status=pending", Boolean(verified.access_token) && verified.worker?.gov_approve_status === "pending", JSON.stringify(verified.worker?.gov_approve_status));
  const wTok = { Authorization: `Bearer ${verified.access_token}` };

  // ── 3. Public directory hides a PENDING worker ───────────────────────
  r = await fetch(`${B}/public/workers?name=Smoke%20Tester`);
  let dir = await r.json();
  check("pending worker NOT in public directory", dir.workers?.every((w) => w.full_name !== "Smoke Tester"), `total=${dir.total}`);

  // ── 4. Government acceptance ─────────────────────────────────────────
  r = await fetch(`${B}/auth/government/login`, { method: "POST", headers: J, body: JSON.stringify({ employee_id: "ADMIN001", password: "Admin@123" }) });
  const gov = await r.json();
  const gt = { Authorization: `Bearer ${gov.access_token}`, ...J };
  check("government login", r.status === 200);

  r = await fetch(`${B}/government/worker-approvals?status=pending`, { headers: gt });
  const queue = await r.json();
  const row = queue.workers?.find((w) => w.worker_id === workerIdCode);
  check("pending worker in government approvals queue", Boolean(row), `counts=${JSON.stringify(queue.counts)}`);
  workerOid = row?.id || "";

  r = await fetch(`${B}/government/workers/${workerOid}/approval`, { method: "PATCH", headers: gt, body: JSON.stringify({ status: "accepted" }) });
  check("government accepts worker", r.status === 200 && (await r.json()).gov_approve_status === "accepted");

  // ── 5. Accepted worker NOW appears in the public directory ───────────
  r = await fetch(`${B}/public/workers?name=Smoke%20Tester&place=Ernakulam`);
  dir = await r.json();
  const listed = dir.workers?.find((w) => w.full_name === "Smoke Tester");
  check("accepted worker listed publicly (name+place, no phone)", Boolean(listed) && listed.gov_accepted === true && listed.rating?.count === 0 && !("mobile_number" in (listed || {})), JSON.stringify(listed));

  // ── 6. Employer registers, verifies, logs in ─────────────────────────
  mark = otpMark();
  r = await fetch(`${B}/auth/employer/register`, { method: "POST", headers: J, body: JSON.stringify({ mobile_number: E_MOBILE, full_name: "Smoke Contractor", password: PASS, company_name: "Smoke Builders" }) });
  check("employer register → 201", r.status === 201, JSON.stringify(await r.json()));
  otp = await otpSince(E_MOBILE, mark);
  check("employer OTP printed in backend terminal", Boolean(otp));
  r = await fetch(`${B}/auth/employer/otp/verify`, { method: "POST", headers: J, body: JSON.stringify({ mobile_number: E_MOBILE, otp }) });
  const emp = await r.json();
  check("employer otp verify → JWT", Boolean(emp.access_token));
  employerToken = emp.access_token;
  employerOid = emp.employer?.id || "";

  // ── 7. Employer rates the worker 4★ ──────────────────────────────────
  r = await fetch(`${B}/ratings/worker/${workerOid}`, { method: "POST", headers: { Authorization: `Bearer ${employerToken}`, ...J }, body: JSON.stringify({ stars: 4, comment: "Punctual and skilled.", employer_name: "Smoke Builders" }) });
  const rate = await r.json();
  check("employer rates worker → summary average=4 count=1", r.status === 200 && rate.summary?.average === 4 && rate.summary?.count === 1, JSON.stringify(rate.summary));

  // ── 8. Public (common-person) rating, deduped per phone ──────────────
  r = await fetch(`${B}/ratings/worker/${workerOid}`, { method: "POST", headers: J, body: JSON.stringify({ stars: 5, rater_name: "Common Person", rater_phone: PUB_PHONE }) });
  check("public rater (name+phone, no account) → 200", r.status === 200, `got ${r.status}`);
  r = await fetch(`${B}/ratings/worker/${workerOid}`, { method: "POST", headers: J, body: JSON.stringify({ stars: 1, rater_name: "Common Person", rater_phone: PUB_PHONE }) });
  check("same phone cannot rate twice → 409", r.status === 409, `got ${r.status}`);
  r = await fetch(`${B}/ratings/worker/${workerOid}`, { headers: J });
  const sum = await r.json();
  check("rating summary merges both raters (4.5 / 2)", sum.average === 4.5 && sum.count === 2, JSON.stringify(sum));

  // ── 9. Government posts a job; worker sees it SCORED (job matching) ──
  r = await fetch(`${B}/jobs`, { method: "POST", headers: gt, body: JSON.stringify({
    title: JOB_TITLE, description: "Smoke-test listing for match scoring.",
    employer_name: "Smoke Builders", occupation: "construction",
    state: "Kerala", district: "Ernakulam", work_location: "Kakkanad",
    wage_min: 700, wage_max: 900, wage_period: "day", openings: 2,
  }) });
  const job = await r.json();
  jobOid = job.id || "";
  check("government posts job listing", r.status === 201 && Boolean(jobOid), JSON.stringify(job));

  r = await fetch(`${B}/jobs`, { headers: wTok });
  const jobs = await r.json();
  const mine = jobs.jobs?.find((j) => j.title === JOB_TITLE);
  check("job matching: same trade+district job scored & surfaced", Boolean(mine) && typeof mine.match?.score === "number" && mine.match.score > 0, mine ? `score=${mine.match.score} reasons=${JSON.stringify(mine.match.reasons ?? null)}` : "not found");

  // ── 10. Lost PASSWORD → reset with recovery key ──────────────────────
  r = await fetch(`${B}/auth/worker/recover/password`, { method: "POST", headers: J, body: JSON.stringify({ worker_id: workerIdCode, recovery_key: "SRK-XXXX-XXXX-XXXX", new_password: NEW_PASS }) });
  check("wrong recovery key rejected → 401", r.status === 401, `got ${r.status}`);
  r = await fetch(`${B}/auth/worker/recover/password`, { method: "POST", headers: J, body: JSON.stringify({ worker_id: workerIdCode, recovery_key: reg.recovery_key, new_password: NEW_PASS }) });
  check("recovery key resets password", r.status === 200, JSON.stringify(await r.json()));
  r = await fetch(`${B}/auth/worker/login`, { method: "POST", headers: J, body: JSON.stringify({ mobile_number: W_MOBILE, password: PASS }) });
  check("old password no longer works → 401", r.status === 401, `got ${r.status}`);
  r = await fetch(`${B}/auth/worker/login`, { method: "POST", headers: J, body: JSON.stringify({ mobile_number: W_MOBILE, password: NEW_PASS }) });
  check("new password logs in", r.status === 200, `got ${r.status}`);

  // ── 11. Lost PHONE → move account to a new number via recovery key ───
  mark = otpMark();
  r = await fetch(`${B}/auth/worker/recover/mobile`, { method: "POST", headers: J, body: JSON.stringify({ worker_id: workerIdCode, recovery_key: reg.recovery_key, new_mobile_number: NEW_MOBILE }) });
  check("recover/mobile sends OTP to the NEW number", r.status === 200, `got ${r.status}`);
  otp = await otpSince(NEW_MOBILE, mark);
  r = await fetch(`${B}/auth/worker/recover/mobile/confirm`, { method: "POST", headers: J, body: JSON.stringify({ worker_id: workerIdCode, recovery_key: reg.recovery_key, new_mobile_number: NEW_MOBILE, otp }) });
  const moved = await r.json();
  check("confirm → account claimed on new number (JWT)", r.status === 200 && Boolean(moved.access_token), JSON.stringify(moved.detail || "ok"));
  r = await fetch(`${B}/auth/worker/me`, { headers: { Authorization: `Bearer ${moved.access_token}` } });
  const me = await r.json();
  check("/me shows the NEW mobile", me.mobile_number === NEW_MOBILE, me.mobile_number);

  // ── 12. Clean up: this script's rows must not disturb verify.mjs ─────
  // Delete strictly by the _ids this run created — never by worker_id
  // string: codes can coincide with seeded accounts, and an earlier version
  // of this script deleted a demo worker that way.
  await mongoose.connect("mongodb://127.0.0.1:27017/shramsetu");
  const db = mongoose.connection.db;
  const ids = [workerOid, employerOid].filter(Boolean).map((id) => new mongoose.Types.ObjectId(id));
  await db.collection("worker_ratings").deleteMany({ worker_id: { $in: ids } });
  await db.collection("job_postings").deleteMany({ title: JOB_TITLE });
  const res = await db.collection("users").deleteMany({ _id: { $in: ids } });
  check("cleanup: created rows deleted", res.deletedCount >= 2, `deleted ${res.deletedCount} user(s)`);
} catch (err) {
  check("smoke script completed without crashing", false, String(err));
} finally {
  await mongoose.disconnect().catch(() => {});
}

console.log(results.map((x) => x.join("  ")).join("\n"));
const fails = results.filter((x) => x[0] === "FAIL").length;
console.log(`\n${results.length - fails}/${results.length} live smoke checks passed${fails ? ` · ${fails} FAILED` : ""}`);
process.exit(fails ? 1 : 0);
