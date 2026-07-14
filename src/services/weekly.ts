import { config } from "../config.js";
import type { WeekEntry } from "../db/schema.js";

// Deterministic fallback used when Bedrock is disabled or errors out.
function plainWeeklyUpdate(entries: WeekEntry[]): string {
  const bullets = entries.map((e) => `• ${e.content}`).join("\n");
  return `Weekly Update\n\n${bullets}`;
}

/**
 * Produce a polished Weekly Update from the week's logged notes.
 * Uses Bedrock with the fixed prompt when enabled; otherwise returns a plain
 * bulleted list. Never throws — always returns something sendable.
 */
export async function buildWeeklyUpdate(
  entries: WeekEntry[],
  technical = false
): Promise<{ text: string; ai: boolean }> {
  if (entries.length === 0) {
    return { text: "Weekly Update\n\n_No work was logged this week._", ai: false };
  }
  if (config.bedrock.enabled && config.bedrock.modelId) {
    try {
      const { generateWeeklyUpdate } = await import("./bedrock.js");
      const text = await generateWeeklyUpdate(
        entries.map((e) => e.content),
        technical
      );
      return { text, ai: true };
    } catch (err) {
      console.warn("Weekly update AI generation failed, using plain format:", (err as Error).message);
    }
  }
  return { text: plainWeeklyUpdate(entries), ai: false };
}
