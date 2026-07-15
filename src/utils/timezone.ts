import { DateTime } from "luxon";

function isValidZone(z: string): boolean {
  return DateTime.now().setZone(z).isValid;
}

// Common colloquial names → IANA, so "dubai" / "uae" / "india" resolve.
const ALIASES: Record<string, string> = {
  dubai: "Asia/Dubai",
  uae: "Asia/Dubai",
  "abu dhabi": "Asia/Dubai",
  india: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  mumbai: "Asia/Kolkata",
  bangalore: "Asia/Kolkata",
  pakistan: "Asia/Karachi",
  karachi: "Asia/Karachi",
  lahore: "Asia/Karachi",
  uk: "Europe/London",
  london: "Europe/London",
  england: "Europe/London",
  usa: "America/New_York",
  "new york": "America/New_York",
  nyc: "America/New_York",
  la: "America/Los_Angeles",
  "los angeles": "America/Los_Angeles",
  california: "America/Los_Angeles",
  singapore: "Asia/Singapore",
  tokyo: "Asia/Tokyo",
  japan: "Asia/Tokyo",
  sydney: "Australia/Sydney",
  australia: "Australia/Sydney",
  berlin: "Europe/Berlin",
  germany: "Europe/Berlin",
  paris: "Europe/Paris",
  france: "Europe/Paris",
  toronto: "America/Toronto",
  canada: "America/Toronto",
  riyadh: "Asia/Riyadh",
  "saudi arabia": "Asia/Riyadh",
  ksa: "Asia/Riyadh",
  doha: "Asia/Qatar",
  qatar: "Asia/Qatar",
};

function allZones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  return anyIntl.supportedValuesOf ? anyIntl.supportedValuesOf("timeZone") : [];
}

/**
 * Resolve free-text into a valid IANA timezone.
 * Accepts exact IANA ("Asia/Dubai"), colloquial names ("dubai", "uae"),
 * or a city that matches an IANA zone. Returns null if nothing matches.
 */
export function resolveTimezone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // 1. Exact IANA name.
  if (raw.includes("/") && isValidZone(raw)) return raw;

  const key = raw.toLowerCase();

  // 2. Colloquial alias.
  if (ALIASES[key]) return ALIASES[key];

  // 3. Search the IANA list by city segment, then by substring.
  const norm = key.replace(/\s+/g, "_");
  const zones = allZones();
  const byCity = zones.find((z) => z.toLowerCase().split("/").pop() === norm);
  if (byCity) return byCity;
  const byContains = zones.find((z) => z.toLowerCase().includes(norm));
  if (byContains) return byContains;

  // 4. Last chance: maybe it's a valid zone without a slash (e.g. "UTC").
  if (isValidZone(raw)) return raw;

  return null;
}

// Current local time in a zone, for confirmation messages.
export function localTimeIn(zone: string): string {
  return DateTime.now().setZone(zone).toFormat("h:mm a, ccc");
}
