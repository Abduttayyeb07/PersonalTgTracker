import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createBot, setCommands } from "./bot.js";
import { startScheduler } from "./services/scheduler.js";
import { config } from "./config.js";
import { db, pool } from "./db/index.js";

async function main() {
  // Apply any pending migrations on boot so `npm run dev` and Docker both "just work".
  console.log("Applying database migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database ready.");

  const bot = createBot();
  await setCommands(bot);
  startScheduler(bot);

  console.log(
    `Personal Tracker starting… Bedrock AI parsing: ${config.bedrock.enabled ? "ON" : "OFF (chrono only)"}`
  );

  // Graceful shutdown.
  const stop = async () => {
    console.log("Shutting down…");
    await bot.stop();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await bot.start({
    onStart: (me) => console.log(`✅ @${me.username} is live.`),
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
