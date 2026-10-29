// State shapes returned by the hand-over server actions (shared with client components).

export type CodeState =
  | { error?: string; code?: undefined }
  | { error?: undefined; code: string; expiresAt: number; purpose: "check_out" | "return" }
  | undefined;
