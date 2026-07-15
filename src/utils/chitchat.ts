// Common greetings/acknowledgements that should never become a task on their own.
const CHITCHAT = new Set([
  "hi", "hello", "hey", "hiya", "yo", "sup", "hola",
  "ok", "okay", "k", "kk", "alright", "sure", "cool", "nice", "great", "fine",
  "thanks", "thank you", "thx", "ty", "np", "no problem",
  "yes", "yeah", "yep", "yup", "no", "nope", "nah",
  "bye", "goodbye", "see ya", "gn", "good night", "gm", "good morning",
  "lol", "haha", "hehe", "lmao",
  "test", "testing", "hmm", "huh", "what", "why",
  "wow", "nice one", "good job", "well done",
]);

// Detects a plain greeting/acknowledgement so quick-add doesn't turn small talk
// into a task. Anything with actual content (dates, verbs, longer text) passes through.
export function isChitChat(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+$/g, "")
    .replace(/\s+/g, " ");
  return CHITCHAT.has(normalized);
}
