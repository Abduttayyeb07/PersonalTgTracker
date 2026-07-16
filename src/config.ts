import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  databaseUrl: required("DATABASE_URL"),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || "UTC",
  defaultDigestHour: Number(process.env.DEFAULT_DIGEST_HOUR ?? 9),
  schedulerIntervalSeconds: Number(process.env.SCHEDULER_INTERVAL_SECONDS ?? 30),
  bedrock: {
    enabled: /^true$/i.test(process.env.ENABLE_BEDROCK_API ?? ""),
    region: process.env.AWS_BEDROCK_REGION || "us-east-1",
    modelId: process.env.AWS_BEDROCK_MODEL || "",
    endpointUrl: process.env.AWS_BEDROCK_ENDPOINT_URL || undefined,
    // Credentials are read by the AWS SDK from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY || "",
    enabled: Boolean(process.env.TAVILY_API_KEY),
  },
  // Fixed cadence for topic watches ("what's new in X" auto-digests).
  watchIntervalDays: Number(process.env.WATCH_INTERVAL_DAYS ?? 7),
};
