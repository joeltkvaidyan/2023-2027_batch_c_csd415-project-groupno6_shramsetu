import mongoose from "mongoose";
import { OCCUPATIONS } from "../utils/occupations.js";

const { Schema } = mongoose;

export const REQUEST_STATUSES = ["open", "accepted", "done", "cancelled"];
export const REQUEST_OCCUPATIONS = [...OCCUPATIONS, "any"];

/**
 * ServiceRequest — a household/citizen's "I need a worker near me" request.
 *
 * Design constraints (social contract, enforced in routes, not just here):
 *  - The CITIZEN's identity is stored for safety (who requested, who to
 *    contact) but contact phones are NEVER revealed cross-side until the
 *    WORKER accepts the request — a worker browses requests without
 *    exposing their number, and a citizen browsing the public directory
 *    never sees one (public.js already excludes it).
 *  - On ACCEPT, both sides see each other's phone: the citizen gets
 *    `worker_contact_phone` (tel:/sms: buttons) and the worker sees the
 *    citizen phone in their accepted list.
 *  - No chat log is stored: ShramSetu brokers the introduction, then hands
 *    over to a plain call/SMS. Fewer stored messages, fewer leak surfaces.
 */
const ServiceRequestSchema = new Schema(
  {
    citizen_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    citizen_name: { type: String, required: true, trim: true, maxlength: 120 },
    contact_phone: { type: String, required: true }, // citizen's mobile (revealed only on accept)

    occupation: { type: String, enum: REQUEST_OCCUPATIONS, required: true, index: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    area_village: { type: String, default: null, trim: true, maxlength: 120 },
    district: { type: String, default: null, trim: true, maxlength: 80, index: true },
    state: { type: String, default: null, trim: true, maxlength: 80, index: true },
    preferred_time: { type: String, default: null, trim: true, maxlength: 60 },

    status: { type: String, enum: REQUEST_STATUSES, default: "open", index: true },

    accepted_worker_id: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    accepted_worker_code: { type: String, default: null }, // SS-XXXXXX snapshot
    accepted_worker_name: { type: String, default: null },
    accepted_worker_phone: { type: String, default: null },
    worker_occupation: { type: String, default: null },
    accepted_at: { type: Date, default: null },
    done_at: { type: Date, default: null },
  },
  { timestamps: true, collection: "service_requests" }
);

ServiceRequestSchema.index({ status: 1, state: 1, district: 1, occupation: 1, createdAt: -1 });

/** What a WORKER sees when browsing open requests (no citizen phone here). */
ServiceRequestSchema.methods.toWorkerJSON = function (scored) {
  return {
    id: String(this._id),
    occupation: this.occupation,
    description: this.description,
    area_village: this.area_village,
    district: this.district,
    state: this.state,
    preferred_time: this.preferred_time,
    citizen_name: this.citizen_name,
    status: this.status,
    created_at: this.createdAt,
    ...(scored ? { match: scored } : {}),
  };
};

/** What the CITIZEN sees of their own request (contact only once accepted). */
ServiceRequestSchema.methods.toCitizenJSON = function () {
  const accepted = this.status === "accepted" || this.status === "done";
  return {
    id: String(this._id),
    occupation: this.occupation,
    description: this.description,
    area_village: this.area_village,
    district: this.district,
    state: this.state,
    preferred_time: this.preferred_time,
    status: this.status,
    created_at: this.createdAt,
    worker: accepted
      ? {
          id: String(this.accepted_worker_id),
          worker_code: this.accepted_worker_code,
          full_name: this.accepted_worker_name,
          occupation: this.worker_occupation,
          phone: this.accepted_worker_phone,
        }
      : null,
  };
};

/** What the WORKER sees of requests they accepted (citizen contact revealed). */
ServiceRequestSchema.methods.toAcceptedWorkerJSON = function () {
  return {
    id: String(this._id),
    occupation: this.occupation,
    description: this.description,
    area_village: this.area_village,
    district: this.district,
    state: this.state,
    preferred_time: this.preferred_time,
    status: this.status,
    created_at: this.createdAt,
    accepted_at: this.accepted_at,
    citizen: {
      name: this.citizen_name,
      phone: this.contact_phone,
    },
  };
};

export const ServiceRequest = mongoose.model("ServiceRequest", ServiceRequestSchema);
