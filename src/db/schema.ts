import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export type Role = "member" | "owner" | "manager" | "admin";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull().default("member"),
  department: text("department").notNull(),
  affiliation: text("affiliation").notNull().default("student"), // student | researcher | staff | external
  idVerified: integer("id_verified", { mode: "boolean" }).notNull().default(false),
  strikes: integer("strikes").notNull().default(0),
  suspended: integer("suspended", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

// Training / qualification records. Only a manager or admin can mark them verified.
export const certifications = sqliteTable("certifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  certKey: text("cert_key").notNull(),
  evidence: text("evidence").notNull(),
  status: text("status").$type<"pending" | "verified" | "rejected">().notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: integer("created_at").notNull(),
  reviewedAt: integer("reviewed_at"),
});

export const resources = sqliteTable("resources", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  category: text("category").$type<"space" | "equipment" | "tool" | "device">().notNull(),
  description: text("description").notNull(),
  location: text("location").notNull(),
  department: text("department").notNull(),
  emoji: text("emoji").notNull().default("🧰"),
  tags: text("tags").notNull().default(""), // comma separated, used for matching
  requiredCerts: text("required_certs").notNull().default("[]"), // JSON string[]
  requiresIdVerified: integer("requires_id_verified", { mode: "boolean" }).notNull().default(true),
  allowedAffiliations: text("allowed_affiliations").notNull().default('["student","researcher","staff"]'),
  supervisionRequired: integer("supervision_required", { mode: "boolean" }).notNull().default(false),
  depositRequired: integer("deposit_required").notNull().default(0), // rupees, recorded not charged
  openHour: integer("open_hour").notNull().default(9),
  closeHour: integer("close_hour").notNull().default(18),
  openDays: text("open_days").notNull().default("[1,2,3,4,5]"), // 0 = Sunday
  maxHours: integer("max_hours").notNull().default(4),
  weeklyHourCap: integer("weekly_hour_cap").notNull().default(8), // per user, rolling 7 days
  usageRules: text("usage_rules").notNull(),
  autoApprove: integer("auto_approve", { mode: "boolean" }).notNull().default(false),
  status: text("status").$type<"active" | "maintenance" | "retired">().notNull().default("active"),
  // Physical handover: secret encoded in the printed QR tag stuck on the item / door.
  qrSecret: text("qr_secret").notNull().default(""),
  // Impact: what renting an equivalent outside campus would cost per hour (₹), and purchase price.
  marketRatePerHour: integer("market_rate_per_hour").notNull().default(0),
  purchaseValue: integer("purchase_value").notNull().default(0),
  // Allocation: first-come review, or periodic weighted-lottery rounds for high-demand resources.
  allocationMode: text("allocation_mode").$type<"review" | "rounds">().notNull().default("review"),
  roundLeadHours: integer("round_lead_hours").notNull().default(24), // requests for a day close this many hours before it starts
  createdAt: integer("created_at").notNull(),
});

export type BookingStatus =
  | "pending"
  | "approved"
  | "waitlisted"
  | "rejected"
  | "cancelled"
  | "checked_out"
  | "returned"
  | "closed";

export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id").notNull(),
    userId: text("user_id").notNull(),
    start: integer("start").notNull(),
    end: integer("end").notNull(),
    purpose: text("purpose").notNull(),
    purposeType: text("purpose_type").$type<"coursework" | "research" | "project" | "personal">().notNull(),
    status: text("status").$type<BookingStatus>().notNull().default("pending"),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    eligibilitySnapshot: text("eligibility_snapshot").notNull().default("{}"), // JSON EligibilityResult at request time
    priorityScore: integer("priority_score").notNull().default(0),
    priorityBreakdown: text("priority_breakdown").notNull().default("[]"),
    aiReview: text("ai_review"),
    checkOutAt: integer("check_out_at"),
    checkOutCondition: text("check_out_condition"),
    checkOutNotes: text("check_out_notes"),
    checkOutPhoto: text("check_out_photo"),
    returnAt: integer("return_at"),
    returnCondition: text("return_condition"),
    returnNotes: text("return_notes"),
    returnPhoto: text("return_photo"),
    returnConfirmedBy: text("return_confirmed_by"),
    remindedAt: integer("reminded_at"),
    overdueNotifiedAt: integer("overdue_notified_at"),
    // How presence was proven at hand-over: scanned the item's QR tag, staff one-time code, or manual staff entry.
    checkOutMethod: text("check_out_method").$type<"qr" | "staff_code" | "staff_manual">(),
    returnMethod: text("return_method").$type<"qr" | "staff_code" | "staff_manual">(),
    aiConditionDiff: text("ai_condition_diff"), // JSON: vision comparison of check-in vs return photos (advisory)
    roundId: text("round_id"), // set when the booking was requested into an allocation round
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("bookings_resource_idx").on(t.resourceId), index("bookings_user_idx").on(t.userId)],
);

export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id"),
  resourceId: text("resource_id").notNull(),
  reporterId: text("reporter_id").notNull(),
  subjectUserId: text("subject_user_id"),
  type: text("type").$type<"damage" | "delay" | "conflict" | "misuse" | "safety" | "other">().notNull(),
  severity: text("severity").$type<"low" | "medium" | "high">().notNull(),
  description: text("description").notNull(),
  aiSummary: text("ai_summary"),
  status: text("status").$type<"open" | "resolved" | "dismissed">().notNull().default("open"),
  resolution: text("resolution"),
  strikeIssued: integer("strike_issued", { mode: "boolean" }).notNull().default(false),
  resolvedBy: text("resolved_by"),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
});

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId)],
);

// Append-only, hash-chained activity history ("the Weave").
export const auditLog = sqliteTable(
  "audit_log",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    bookingId: text("booking_id"),
    details: text("details").notNull().default("{}"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("audit_entity_idx").on(t.entityId), index("audit_booking_idx").on(t.bookingId)],
);

// Short-lived codes a staff member reads out to co-sign a supervised hand-over.
export const handoverCodes = sqliteTable("handover_codes", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  staffId: text("staff_id").notNull(),
  purpose: text("purpose").$type<"check_out" | "return">().notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
});

// Weighted lottery rounds for high-demand resources (commit-reveal, publicly verifiable).
export const allocationRounds = sqliteTable("allocation_rounds", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id").notNull(),
  dayStart: integer("day_start").notNull(), // campus midnight of the day being allocated
  closesAt: integer("closes_at").notNull(),
  status: text("status").$type<"open" | "drawn">().notNull().default("open"),
  seedCommitment: text("seed_commitment").notNull(), // sha256(seed), published while open
  seed: text("seed"), // revealed at draw
  results: text("results"), // JSON draw log
  drawnAt: integer("drawn_at"),
  createdAt: integer("created_at").notNull(),
});

// Fairness credit: people who lose a draw get a boost next time on that resource.
export const fairnessCredits = sqliteTable("fairness_credits", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  resourceId: text("resource_id").notNull(),
  credits: integer("credits").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

// Two-sided incidents: borrower (and others involved) add their side before a manager decides.
export const incidentStatements = sqliteTable("incident_statements", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").$type<"borrower" | "owner" | "manager" | "witness">().notNull(),
  body: text("body").notNull(),
  photo: text("photo"),
  createdAt: integer("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Resource = typeof resources.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type HandoverCode = typeof handoverCodes.$inferSelect;
export type AllocationRound = typeof allocationRounds.$inferSelect;
export type FairnessCredit = typeof fairnessCredits.$inferSelect;
export type IncidentStatement = typeof incidentStatements.$inferSelect;
