import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import authRoutes from "./routes/auth.js";
import grievanceRoutes from "./routes/grievances.js";
import notificationRoutes from "./routes/notifications.js";
import documentRoutes from "./routes/documents.js";
import governmentRoutes from "./routes/government.js";
import settingsRoutes from "./routes/settings.js";
import chatRoutes from "./routes/chat.js";
import wageRoutes from "./routes/wages.js";
import jobRoutes from "./routes/jobs.js";
import employerRoutes from "./routes/employers.js";
import ratingRoutes from "./routes/ratings.js";
import publicRoutes from "./routes/public.js";
import directoryRoutes from "./routes/directory.js";
import requestRoutes from "./routes/requests.js";
import engagementRoutes from "./routes/engagements.js";
import wageSlipRoutes from "./routes/wageSlips.js";
import recordRoutes from "./routes/records.js";
import idCardRoutes from "./routes/idCard.js";

/**
 * The Express app, separated from bootstrap (DB connect + listen) so the
 * integration tests can exercise the full middleware stack over supertest.
 */
const app = express();
// req.ip (and therefore every rate-limit key) must be the REAL client, not the
// reverse proxy in front of us. One hop in production by default; set
// TRUST_PROXY=0 when the app is exposed directly, or to the hop count / CIDR
// list your topology needs. Never `true`: that lets any client forge
// X-Forwarded-For and walk past the limiters.
app.set("trust proxy", config.trustProxy);

// Security headers. This is a JSON API (no HTML), so CSP is disabled here;
// the SPA's own headers belong to the frontend host.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "2mb" }));

// CORS: the allowlist is used whenever CORS_ORIGINS is non-empty (it always
// is — config.js ships dev defaults), not just in production.
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  })
);

// General API limiter (auth endpoints add their own stricter limits).
app.use("/api", apiLimiter);

app.get("/health", (req, res) => res.json({ status: "ok", service: "shramsetu-server" }));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/grievances", grievanceRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/documents", documentRoutes);
app.use("/api/v1/government", governmentRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/wages", wageRoutes);
app.use("/api/v1/jobs", jobRoutes);
app.use("/api/v1/employers", employerRoutes);
app.use("/api/v1/ratings", ratingRoutes);
app.use("/api/v1/public", publicRoutes);
app.use("/api/v1/directory", directoryRoutes);
app.use("/api/v1/requests", requestRoutes);
app.use("/api/v1/engagements", engagementRoutes);
app.use("/api/v1/wage-slips", wageSlipRoutes);
app.use("/api/v1/records", recordRoutes);
app.use("/api/v1/id-card", idCardRoutes);

// 404 for unknown API routes
app.use("/api", (req, res) => res.status(404).json({ detail: "Not found" }));

// Central error handler
app.use((err, req, res, next) => {
  console.error("[server]", err);
  if (res.headersSent) return;
  if (err?.type === "entity.too.large") return res.status(413).json({ detail: "Request body too large" });
  res.status(500).json({ detail: "Internal server error" });
});

export default app;
