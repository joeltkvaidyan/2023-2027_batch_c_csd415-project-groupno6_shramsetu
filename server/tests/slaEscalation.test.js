/**
 * SLA escalation: a deadline is only worth writing down if something happens
 * when it passes.
 *
 * What this file protects:
 *   1. an open, past-deadline grievance moves exactly one rung per sweep, and
 *      only once — a restart must not re-escalate it,
 *   2. the second rung waits for the grace window,
 *   3. closed grievances and complaints still inside their deadline are left
 *      alone,
 *   4. the overdue view is scoped like every other government list.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Grievance } from "../src/models/Grievance.js";
import { AuditLog } from "../src/models/Document.js";
import { hashPassword, signToken } from "../src/utils/crypto.js";
import { escalateOverdueGrievances, daysOverdue } from "../src/utils/slaEscalation.js";

const api = supertest(app);
let mongod;
const tokens = {};
const ids = {};

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days) => new Date(Date.now() + days * DAY);

async function makeUser(over = {}) {
  return User.create({
    role: over.role || "worker",
    full_name: over.full_name || "Test Worker",
    mobile_number: over.mobile_number || `7${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword("Test@123"),
    is_phone_verified: true,
    is_active: true,
    ...over.fields,
  });
}

async function makeGrievance(worker, over = {}) {
  return Grievance.create({
    complaint_number: `GR-SLA-${crypto.randomInt(100000, 999999)}`,
    owner_id: worker._id,
    owner_state: worker.current_state,
    owner_district: worker.current_district,
    category: "unpaid_wages",
    subject: "Two weeks of wages not paid",
    description: "Site supervisor has stopped answering.",
    status: "submitted",
    priority: "high",
    sla_deadline: daysFromNow(-2),
    ...over,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-sla"));

  const districtOfficial = await makeUser({
    role: "government",
    full_name: "Ernakulam Officer",
    fields: { employee_id: "EKM-SLA", state: "Kerala", district: "Ernakulam" },
  });
  const stateOfficial = await makeUser({
    role: "government",
    full_name: "Kerala Officer",
    fields: { employee_id: "KL-SLA", state: "Kerala", district: null },
  });
  const superadmin = await makeUser({
    role: "government",
    full_name: "Super Admin",
    fields: { employee_id: "ADM-SLA", state: null, district: null, is_superadmin: true },
  });
  const employer = await makeUser({ role: "employer", full_name: "Site Owner" });

  const ernakulam = await makeUser({
    full_name: "Lakshmi Devi",
    fields: {
      worker_id: "SS-810001",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  const thrissur = await makeUser({
    full_name: "Anand Menon",
    fields: {
      worker_id: "SS-810002",
      current_state: "Kerala",
      current_district: "Thrissur",
      gov_approve_status: "accepted",
    },
  });
  const coimbatore = await makeUser({
    full_name: "Karthik Rajan",
    fields: {
      worker_id: "SS-810003",
      current_state: "Tamil Nadu",
      current_district: "Coimbatore",
      gov_approve_status: "accepted",
    },
  });

  tokens.district = signToken({ _id: districtOfficial._id, role: districtOfficial.role });
  tokens.state = signToken({ _id: stateOfficial._id, role: stateOfficial.role });
  tokens.superadmin = signToken({ _id: superadmin._id, role: superadmin.role });
  tokens.employer = signToken({ _id: employer._id, role: employer.role });

  ids.overdueErnakulam = await makeGrievance(ernakulam, { sla_deadline: daysFromNow(-2) });
  ids.overdueThrissur = await makeGrievance(thrissur, { sla_deadline: daysFromNow(-5) });
  ids.overdueCoimbatore = await makeGrievance(coimbatore, {
    sla_deadline: daysFromNow(-1),
    category: "workplace_safety",
  });
  ids.resolvedLate = await makeGrievance(ernakulam, {
    sla_deadline: daysFromNow(-9),
    status: "resolved",
    resolved_at: daysFromNow(-1),
  });
  ids.stillInTime = await makeGrievance(ernakulam, { sla_deadline: daysFromNow(4) });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("daysOverdue()", () => {
  it("counts whole days late and never goes negative", () => {
    const now = new Date("2026-11-14T10:00:00Z");
    expect(daysOverdue("2026-11-12T10:00:00Z", now)).toBe(2);
    expect(daysOverdue("2026-11-20T10:00:00Z", now)).toBe(0);
    expect(daysOverdue(null, now)).toBe(null);
  });
});

describe("escalation sweep", () => {
  it("tells the district office about every open breach, once", async () => {
    const first = await escalateOverdueGrievances();
    expect(first.districtEscalated).toBe(3);

    for (const key of ["overdueErnakulam", "overdueThrissur", "overdueCoimbatore"]) {
      const g = await Grievance.findById(ids[key]._id).lean();
      expect(g.escalation_level).toBe(1);
      expect(g.escalated).toBe(true);
      expect(g.escalated_at).not.toBe(null);
      const notes = g.timeline.filter((t) => /Escalated to/.test(t.note || ""));
      expect(notes).toHaveLength(1);
      expect(notes[0].note).toContain("district labour office");
    }

    const ernakulam = await Grievance.findById(ids.overdueErnakulam._id).lean();
    expect(ernakulam.timeline.at(-1).note).toContain("Ernakulam district labour office");

    // The claim is atomic and filtered on the level, so a restart is silent.
    const second = await escalateOverdueGrievances();
    expect(second.districtEscalated).toBe(0);
    const after = await Grievance.findById(ids.overdueErnakulam._id).lean();
    expect(after.timeline.filter((t) => /Escalated to/.test(t.note || ""))).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: "grievance.escalate" })).toBe(3);
  });

  it("leaves closed complaints and complaints still inside their deadline alone", async () => {
    const resolved = await Grievance.findById(ids.resolvedLate._id).lean();
    expect(resolved.escalation_level).toBe(0);
    expect(resolved.timeline).toHaveLength(0);

    const inTime = await Grievance.findById(ids.stillInTime._id).lean();
    expect(inTime.escalation_level).toBe(0);
  });

  it("waits out the grace window before telling the state office", async () => {
    // Escalated moments ago: no second rung yet.
    const early = await escalateOverdueGrievances();
    expect(early.stateEscalated).toBe(0);

    await Grievance.updateOne(
      { _id: ids.overdueThrissur._id },
      { $set: { escalated_at: daysFromNow(-8) } },
    );

    const late = await escalateOverdueGrievances();
    expect(late.stateEscalated).toBe(1);

    const g = await Grievance.findById(ids.overdueThrissur._id).lean();
    expect(g.escalation_level).toBe(2);
    expect(g.state_escalated_at).not.toBe(null);
    expect(g.timeline.at(-1).note).toContain("Kerala state labour office");
    expect(await AuditLog.countDocuments({ action: "grievance.escalate_state" })).toBe(1);

    // And it does not climb again.
    const again = await escalateOverdueGrievances();
    expect(again.stateEscalated).toBe(0);
  });
});

describe("GET /api/v1/government/escalations", () => {
  it("shows a district official only their own district", async () => {
    const res = await api
      .get("/api/v1/government/escalations")
      .set("Authorization", `Bearer ${tokens.district}`)
      .expect(200);

    const numbers = res.body.escalations.map((e) => e.complaint_number);
    expect(numbers).toEqual([ids.overdueErnakulam.complaint_number]);
    expect(res.body.escalations[0].days_overdue).toBeGreaterThanOrEqual(2);
    expect(res.body.escalations[0].worker.full_name).toBe("Lakshmi Devi");
  });

  it("shows a state official every district in the state, oldest breach first", async () => {
    const res = await api
      .get("/api/v1/government/escalations")
      .set("Authorization", `Bearer ${tokens.state}`)
      .expect(200);

    const numbers = res.body.escalations.map((e) => e.complaint_number);
    expect(numbers).toEqual([
      ids.overdueThrissur.complaint_number,
      ids.overdueErnakulam.complaint_number,
    ]);
    // The Thrissur complaint has already climbed to the state office.
    const thrissur = res.body.escalations.find(
      (e) => e.complaint_number === ids.overdueThrissur.complaint_number,
    );
    expect(thrissur.escalation_level).toBe(2);
    expect(res.body.total).toBe(2);
  });

  it("never lists a resolved complaint, even when it closed late", async () => {
    const res = await api
      .get("/api/v1/government/escalations")
      .set("Authorization", `Bearer ${tokens.superadmin}`)
      .expect(200);

    const numbers = res.body.escalations.map((e) => e.complaint_number);
    expect(numbers).not.toContain(ids.resolvedLate.complaint_number);
    expect(numbers).toContain(ids.overdueCoimbatore.complaint_number);
    expect(res.body.total).toBe(3);
  });

  it("refuses non-government accounts and anonymous callers", async () => {
    await api
      .get("/api/v1/government/escalations")
      .set("Authorization", `Bearer ${tokens.employer}`)
      .expect(403);
    await api.get("/api/v1/government/escalations").expect(401);
  });
});
