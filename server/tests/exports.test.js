/**
 * CSV exports (inherited from the migrant-worker admin console).
 *
 * What matters:
 *   1. An official can only export rows they can already see — the export
 *      re-uses the jurisdiction scope, it does not bypass it.
 *   2. The file is Excel-safe: UTF-8 BOM, CRLF, quoted fields, and no cell that
 *      a spreadsheet would execute as a formula.
 *   3. Only government accounts can reach it, and the download headers say so.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Grievance } from "../src/models/Grievance.js";
import { hashPassword, signToken } from "../src/utils/crypto.js";
import { toCsv } from "../src/utils/csv.js";

const api = supertest(app);
let mongod;
const tokens = {};

async function makeUser(over = {}) {
  return User.create({
    role: over.role || "worker",
    full_name: over.full_name || "Test Worker",
    mobile_number: over.mobile_number || `8${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword("Test@123"),
    is_phone_verified: true,
    is_active: true,
    ...over.fields,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-exports"));

  const official = await makeUser({
    role: "government",
    full_name: "Official Rao",
    fields: { employee_id: "EKM001X", state: "Karnataka", district: "Bengaluru Urban" },
  });
  const employer = await makeUser({ role: "employer", full_name: "Site Owner" });

  const inScope = await makeUser({
    full_name: "Lakshmi Devi",
    fields: {
      worker_id: "SS-700001",
      occupation: "Mason",
      current_state: "Karnataka",
      current_district: "Bengaluru Urban",
      gov_approve_status: "accepted",
    },
  });
  const outOfScope = await makeUser({
    full_name: "Other State Worker",
    fields: {
      worker_id: "SS-700002",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  // A worker whose name would run as a spreadsheet formula.
  await makeUser({
    full_name: '=HYPERLINK("http://evil.example","open")',
    fields: {
      worker_id: "SS-700003",
      current_state: "Karnataka",
      current_district: "Bengaluru Urban",
    },
  });

  tokens.official = signToken({ _id: official._id, role: official.role });
  tokens.employer = signToken({ _id: employer._id, role: employer.role });

  await Grievance.create({
    complaint_number: "GR-EXP-001",
    owner_id: inScope._id,
    category: "unpaid_wages",
    subject: "Wages pending, 12 days",
    description: "Not paid for two weeks.",
    status: "submitted",
    priority: "medium",
    incident_location: "Whitefield",
    incident_date: new Date(),
  });
  await Grievance.create({
    complaint_number: "GR-EXP-002",
    owner_id: outOfScope._id,
    category: "workplace_safety",
    subject: "No helmet provided",
    description: "Site has no safety gear.",
    status: "resolved",
    priority: "medium",
    incident_location: "Kochi",
    incident_date: new Date(),
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("toCsv()", () => {
  it("starts with a BOM and uses CRLF so Excel on Windows reads Indic text", () => {
    const csv = toCsv([{ name: "রামেশ" }], [{ key: "name", header: "Name" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("রামেশ");
  });

  it("quotes fields containing a comma, quote or newline", () => {
    const csv = toCsv(
      [{ note: 'a, b "c"\nsecond line' }],
      [{ key: "note", header: "Note" }],
    );
    expect(csv).toContain('"a, b ""c""\nsecond line"');
  });

  it("defuses spreadsheet formula injection", () => {
    for (const hostile of ['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)"]) {
      const csv = toCsv([{ v: hostile }], [{ key: "v", header: "V" }]);
      const dataLine = csv.split("\r\n")[1];
      // A hostile cell may also need quoting, in which case the apostrophe sits
      // just inside the opening quote: "'=HYPERLINK(""…"")"
      expect(dataLine.replace(/^"/, "").startsWith("'")).toBe(true);
      expect(dataLine).not.toMatch(/(^|,)=/);
    }
  });

  it("renders null and undefined as empty cells, not the text 'null'", () => {
    const csv = toCsv([{ a: null, b: undefined }], [
      { key: "a", header: "A" },
      { key: "b", header: "B" },
    ]);
    expect(csv.split("\r\n")[1]).toBe(",");
  });
});

describe("GET /api/v1/government/export/workers.csv", () => {
  it("exports only the official's jurisdiction", async () => {
    const res = await api
      .get("/api/v1/government/export/workers.csv")
      .set("Authorization", `Bearer ${tokens.official}`)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.text).toContain("SS-700001");
    expect(res.text).not.toContain("SS-700002");
    expect(res.text).not.toContain("Other State Worker");
  });

  it("neutralises a formula in exported worker data", async () => {
    const res = await api
      .get("/api/v1/government/export/workers.csv")
      .set("Authorization", `Bearer ${tokens.official}`)
      .expect(200);

    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/);
    expect(res.text).toContain("'=HYPERLINK");
  });

  it("refuses non-government accounts", async () => {
    await api
      .get("/api/v1/government/export/workers.csv")
      .set("Authorization", `Bearer ${tokens.employer}`)
      .expect(403);
  });

  it("requires a session", async () => {
    await api.get("/api/v1/government/export/workers.csv").expect(401);
  });
});

describe("GET /api/v1/government/export/grievances.csv", () => {
  it("exports scoped grievances with the worker's identity", async () => {
    const res = await api
      .get("/api/v1/government/export/grievances.csv")
      .set("Authorization", `Bearer ${tokens.official}`)
      .expect(200);

    expect(res.text).toContain("GR-EXP-001");
    expect(res.text).toContain("Lakshmi Devi");
    expect(res.text).not.toContain("GR-EXP-002");
  });

  it("honours the on-screen status filter", async () => {
    const res = await api
      .get("/api/v1/government/export/grievances.csv")
      .query({ status_filter: "resolved" })
      .set("Authorization", `Bearer ${tokens.official}`)
      .expect(200);

    expect(res.text).not.toContain("GR-EXP-001");
  });
});
