import type { Resource } from "@/db/schema";

// Plain-language need -> resource matching. Transparent on purpose: each match lists the words that caused it.
const SYNONYMS: Record<string, string[]> = {
  video: ["camera", "film", "studio", "record"],
  film: ["camera", "video", "documentary"],
  photo: ["camera", "photo"],
  shoot: ["camera", "video"],
  podcast: ["podcast", "audio", "studio"],
  interview: ["studio", "podcast", "meeting"],
  print: ["3d", "print", "printer"],
  prototype: ["prototype", "3d", "laser", "fabrication"],
  cut: ["laser", "cut"],
  engrave: ["laser", "engrave"],
  acrylic: ["laser", "acrylic"],
  wood: ["laser", "plywood", "drill", "jigsaw", "wood"],
  enclosure: ["laser", "3d", "acrylic"],
  ml: ["gpu", "machine learning", "ai", "compute"],
  ai: ["gpu", "ai", "machine learning"],
  model: ["gpu", "3d", "model"],
  train: ["gpu", "training"],
  render: ["gpu", "render"],
  circuit: ["oscilloscope", "solder", "electronics"],
  pcb: ["solder", "pcb", "electronics"],
  signal: ["oscilloscope", "signal"],
  debug: ["oscilloscope", "debug"],
  meeting: ["meeting", "room", "discussion"],
  pitch: ["meeting", "pitch", "hall"],
  event: ["hall", "seminar", "event"],
  talk: ["hall", "seminar", "presentation"],
  workshop: ["hall", "workshop", "seminar"],
  chemistry: ["fume hood", "chemistry", "synthesis"],
  solvent: ["fume hood", "solvent"],
  drone: ["drone", "aerial"],
};

export function matchResources(query: string, resources: Resource[]) {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !["a", "an", "the", "for", "to", "and", "of", "i", "need", "want", "my", "some", "with", "on", "in"].includes(w));
  if (!words.length) return resources.map((r) => ({ r, score: 0, reasons: [] as string[] }));
  return resources
    .map((r) => {
      const hay = { name: r.name.toLowerCase(), tags: r.tags.toLowerCase(), desc: r.description.toLowerCase() };
      let score = 0;
      const reasons = new Set<string>();
      for (const w of words) {
        const stem = w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w; // "stickers" -> "sticker"
        const terms = [...new Set([stem, ...(SYNONYMS[w] ?? SYNONYMS[stem] ?? [])])];
        for (const t of terms) {
          const hit = (hay.name.includes(t) ? 4 : 0) + (hay.tags.includes(t) ? 3 : 0) + (hay.desc.includes(t) ? 1 : 0);
          if (hit) {
            score += t === stem ? hit : hit / 2;
            reasons.add(t === stem ? w : `${w} → ${t}`);
          }
        }
      }
      return { r, score, reasons: [...reasons].slice(0, 4) };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}
