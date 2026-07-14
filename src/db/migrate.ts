import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

// Applies any generated SQL migrations in ./drizzle before the bot starts.
async function main() {
  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
