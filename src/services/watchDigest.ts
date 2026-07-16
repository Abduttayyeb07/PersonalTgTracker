import { config } from "../config.js";
import { searchTopic } from "./search.js";
import { generateTopicUpdate } from "./bedrock.js";

/**
 * Builds a "what's new" digest for a watched topic: search + AI summary.
 * Returns null only when search isn't configured at all (caller should show
 * a distinct "not set up" message in that case, not a generic failure).
 */
export async function buildTopicDigest(topic: string): Promise<string | null> {
  if (!config.tavily.enabled) return null;

  const results = await searchTopic(topic, config.watchIntervalDays);
  if (results.length === 0) {
    return `What's new: ${topic}\n\nNo fresh updates found this time.`;
  }

  try {
    return await generateTopicUpdate(topic, results);
  } catch (err) {
    console.warn(`Topic digest generation failed for "${topic}":`, (err as Error).message);
    const lines = results.slice(0, 6).map((r) => `• ${r.title}`).join("\n");
    return `What's new: ${topic}\n\n${lines}`;
  }
}
