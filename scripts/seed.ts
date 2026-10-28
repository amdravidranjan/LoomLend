// Usage: npm run db:seed   (run with --conditions=react-server so "server-only" imports resolve)
import { seedDemo } from "../src/lib/seed";

seedDemo()
  .then(() => {
    console.log("Seeded LoomLend demo data.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
