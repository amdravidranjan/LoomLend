import "server-only";
import { seedHistory } from "./history";
import { seedHandover } from "./handover";
import { seedAllocation } from "./allocation";

// Order matters: history first so later features can build on it.
export async function seedExtras(now: number) {
  await seedHistory(now);
  await seedHandover(now);
  await seedAllocation(now);
}
