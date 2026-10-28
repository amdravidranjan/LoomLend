// Static reference data shared by server and client code.

export const CERTS: Record<string, { label: string; description: string }> = {
  "lab-safety": { label: "General Lab Safety Induction", description: "Mandatory campus induction: PPE, emergency exits, first aid." },
  "laser-cutter": { label: "Laser Cutter Operator", description: "Hands-on session with the Fab Lab in-charge: materials, fire watch, extraction." },
  "3d-printer": { label: "3D Printer Basics", description: "Slicing, bed levelling, filament handling, failed-print etiquette." },
  "electronics": { label: "Electronics Bench & ESD", description: "ESD handling, probe safety, mains isolation." },
  "chem-safety": { label: "Chemical Handling (Level 1)", description: "MSDS reading, fume hood use, spill response." },
  "av-studio": { label: "AV Studio Orientation", description: "Camera, lighting and audio kit care; booking etiquette." },
  "drone": { label: "Drone Pilot (Campus Rules)", description: "Campus no-fly zones, pre-flight checks, battery safety." },
};

export const CATEGORIES = {
  space: "Space",
  equipment: "Equipment",
  tool: "Tool",
  device: "Device",
} as const;

export const AFFILIATIONS: Record<string, string> = {
  student: "Student",
  researcher: "Researcher",
  staff: "Staff",
  external: "External partner / startup",
};

export const PURPOSES = {
  coursework: "Coursework / lab assignment",
  research: "Research",
  project: "Club or capstone project",
  personal: "Personal learning",
} as const;

export const CONDITIONS = [
  { key: "excellent", label: "Excellent", rank: 5 },
  { key: "good", label: "Good", rank: 4 },
  { key: "fair", label: "Fair (minor wear)", rank: 3 },
  { key: "poor", label: "Poor (needs attention)", rank: 2 },
  { key: "damaged", label: "Damaged", rank: 1 },
] as const;

export function conditionRank(key: string | null | undefined) {
  return CONDITIONS.find((c) => c.key === key)?.rank ?? 0;
}
export function conditionLabel(key: string | null | undefined) {
  return CONDITIONS.find((c) => c.key === key)?.label ?? "—";
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  waitlisted: "Waiting list",
  rejected: "Rejected",
  cancelled: "Cancelled",
  checked_out: "In use",
  returned: "Returned, awaiting confirmation",
  closed: "Completed",
};

export const ROLE_LABEL: Record<string, string> = {
  member: "Member",
  owner: "Resource owner",
  manager: "Department manager",
  admin: "Administrator",
};

export const MAX_OPEN_REQUESTS = 3; // per user across all resources
export const BOOKING_HORIZON_DAYS = 14;
export const STRIKE_LIMIT = 3;
