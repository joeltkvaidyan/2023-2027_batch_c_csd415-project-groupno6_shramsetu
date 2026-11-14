import fs from "node:fs";
import { config, assertProductionSafe } from "./config.js";
import { connectDB } from "./db.js";
import { User } from "./models/User.js";
import { hashPassword } from "./utils/crypto.js";
import { seedDemoData } from "./seed/seed.js";
import { sendExpiryReminders } from "./utils/insuranceReminders.js";
import { escalateOverdueGrievances } from "./utils/slaEscalation.js";
import app from "./app.js";

assertProductionSafe();

// A rejected promise nobody awaited used to kill the process silently on
// modern Node. Log it with the stack so a failing SMS gateway or AI call shows
// up in the server log instead of vanishing.
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled promise rejection:", reason);
});

async function bootstrap() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await connectDB();

  // Schema-upgrade backfill: workers created BEFORE the government
  // acceptance gate have no gov_approve_status field at all. The schema's
  // documented intent is that they keep access ("accepted") — but every
  // real filter is an equality match ("accepted"), so an absent field would
  // hide them from the public directory forever. New registrations always
  // set the field explicitly ("pending"), so this can never accept a fresh
  // signup.
  const backfill = await User.updateMany(
    { role: "worker", gov_approve_status: { $exists: false } },
    { $set: { gov_approve_status: "accepted" } }
  );
  if (backfill.modifiedCount) {
    console.log(`[bootstrap] backfilled gov_approve_status=accepted for ${backfill.modifiedCount} pre-gate worker(s)`);
  }

  // Bootstrap government superadmin — CREATE ONLY. The password is never
  // reset here: an attacker who can restart the server must not be able to
  // take over an admin account whose password was changed.
  const adminId = config.bootstrapAdmin.employeeId;
  const existing = await User.findOne({ role: "government", employee_id: adminId });
  if (!existing) {
    await User.create({
      role: "government",
      employee_id: adminId,
      full_name: "ShramSetu Superadmin",
      mobile_number: "9000000000",
      email: null,
      password_hash: await hashPassword(config.bootstrapAdmin.password),
      department: "Labour Department",
      designation: "Commissioner",
      state: null,
      district: null,
      is_superadmin: true,
      is_active: true,
    });
    console.log(`[bootstrap] admin created: ${adminId}`);
  } else {
    console.log(`[bootstrap] admin exists: ${adminId} (password not modified)`);
  }

  if (config.seedDemoData) {
    await seedDemoData();
  }

  // Insurance cover lapsing in silence is exactly the failure the card exists
  // to prevent, so the reminder sweep runs once at boot and then twice a day.
  // A failure here must not stop the API: a missing nudge is bad, a server
  // that will not start is worse.
  const sweepInsurance = () =>
    sendExpiryReminders().catch((err) => console.error("[insurance-reminders]", err));
  await sweepInsurance();
  // unref() so the interval never keeps the process alive on its own.
  setInterval(sweepInsurance, 12 * 60 * 60 * 1000).unref();

  // Same shape, different promise: a grievance that passes its SLA deadline is
  // escalated to the district office, then the state office. Nothing about a
  // missed deadline should depend on somebody remembering to look.
  const sweepSla = () =>
    escalateOverdueGrievances()
      .then(({ districtEscalated, stateEscalated }) => {
        if (districtEscalated || stateEscalated) {
          console.log(
            `[sla] escalated ${districtEscalated} to district, ${stateEscalated} to state`,
          );
        }
      })
      .catch((err) => console.error("[sla-escalation]", err));
  await sweepSla();
  setInterval(sweepSla, 6 * 60 * 60 * 1000).unref();

  const server = app.listen(config.port, () => {
    console.log(`[server] ShramSetu Node API on http://127.0.0.1:${config.port} (env=${config.env})`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[server] Port ${config.port} is already in use — another ShramSetu API instance is likely running.\n` +
        `         Find it:   netstat -ano | findstr :${config.port}\n` +
        `         Stop it:   taskkill /PID <pid> /F\n` +
        `         (Under 'npm run dev', save a file afterwards to retry.)`
      );
    } else {
      console.error("[server] listen error:", err);
    }
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
