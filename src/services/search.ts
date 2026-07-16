import { config } from "../config.js";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Searches the web for recent news on a topic via Tavily's API. Returns a
 * short list of {title, url, content} snippets, or an empty array on any
 * failure (caller should treat that as "nothing new to report" rather than
 * erroring out to the user).
 */
export async function searchTopic(topic: string, days: number): Promise<SearchResult[]> {
  if (!config.tavily.enabled) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.tavily.apiKey,
        query: `latest news and developments in ${topic}`,
        topic: "news",
        days,
        max_results: 8,
        include_answer: false,
      }),
    });
    if (!res.ok) {
      console.warn(`Tavily search failed (${res.status}) for topic "${topic}"`);
      return [];
    }
    const data = (await res.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    return (data.results ?? [])
      .filter((r) => r.title && r.content)
      .map((r) => ({
        title: r.title as string,
        url: r.url ?? "",
        content: (r.content as string).slice(0, 1200),
      }));
  } catch (err) {
    console.warn(`Tavily search errored for topic "${topic}":`, (err as Error).message);
    return [];
  }
}
