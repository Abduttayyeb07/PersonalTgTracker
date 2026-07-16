import { config } from "../config.js";
import { searchTopic } from "./search.js";
import { generateTopicUpdate } from "./bedrock.js";
import { buildTopicPdf } from "./topicPdf.js";

export type TopicDigestOutcome =
  | { type: "not_configured" }
  | { type: "no_results" }
  | { type: "pdf"; buffer: Buffer };

/**
 * Builds a "what's new" digest for a watched topic: search, AI summary, then
 * a short PDF (summary bullets + real source links). Telegram chat messages
 * aren't a good fit for this — a PDF keeps it skimmable and out of the chat's
 * character limits, with sources the user can actually click through to.
 */
export async function buildTopicDigest(topic: string): Promise<TopicDigestOutcome> {
  if (!config.tavily.enabled) return { type: "not_configured" };

  const results = await searchTopic(topic, config.watchIntervalDays);
  if (results.length === 0) return { type: "no_results" };

  let summary: string;
  try {
    summary = await generateTopicUpdate(topic, results);
  } catch (err) {
    console.warn(`Topic summary generation failed for "${topic}":`, (err as Error).message);
    summary = results.map((r) => r.title).join("\n");
  }

  const buffer = await buildTopicPdf(topic, summary, results);
  return { type: "pdf", buffer };
}
