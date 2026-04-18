/**
 * Voice Humanisms Preprocessor
 * Inserts subtle breathing marks, micro-pauses, and human-like
 * textures into text before sending it to ElevenLabs.
 *
 * The goal: a voice that sounds like someone is here,
 * not like a machine reading text.
 *
 * Techniques used:
 * 1. Ellipsis (...) for micro-hesitations before key words
 * 2. Break tags for breathing pauses between thoughts
 * 3. Soft filler sounds (hm, mhm) for acknowledgment
 * 4. Contextual pauses before heavy or emotional content
 *
 * IMPORTANT: Subtlety is everything. Too much = parody.
 * These are not random. They are context-appropriate.
 */

/** Types of humanisms we can insert */
type HumanismType = 'breath' | 'pause' | 'hesitation' | 'acknowledgment';

interface HumanismRule {
  type: HumanismType;
  /** Regex pattern to match in text */
  pattern: RegExp;
  /** Replacement function */
  replace: (match: string, ...groups: string[]) => string;
  /** Probability of applying (0-1). Keeps it unpredictable. */
  probability: number;
}

/**
 * Seeded pseudo-random based on text content.
 * Same text always produces same humanisms (deterministic for testing).
 */
function seededRandom(text: string, index: number): number {
  let hash = 0;
  const seed = text + String(index);
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash % 100) / 100;
}

/**
 * Rules for inserting humanisms.
 * Each rule has a probability to keep things natural and unpredictable.
 * Lower probability = rarer occurrence = more subtle.
 */
const RULES: HumanismRule[] = [
  // Breathing pause before longer responses (after first sentence)
  {
    type: 'breath',
    pattern: /^(.{40,}?[.!?])\s+/,
    replace: (match, sentence) => `${sentence} ... `,
    probability: 0.35,
  },

  // Micro-hesitation before emotional or reflective words
  {
    type: 'hesitation',
    pattern: /\b(feel|think|believe|remember|imagine|wonder|sense|notice)\b/gi,
    replace: (match) => `...${match}`,
    probability: 0.25,
  },

  // Brief pause before conjunctions that introduce a new thought
  {
    type: 'pause',
    pattern: /([.!?])\s+(And|But|Or|Because|Maybe|Sometimes|Perhaps)\b/g,
    replace: (match, punct, word) => `${punct} ... ${word}`,
    probability: 0.3,
  },

  // Gentle pause before questions directed at the user
  {
    type: 'pause',
    pattern: /([.!])\s+(How|What|Would|Could|Do you|Are you|Have you)\b/g,
    replace: (match, punct, word) => `${punct} ... ${word}`,
    probability: 0.35,
  },

  // Pause after commas in longer clauses (natural breath point)
  {
    type: 'breath',
    pattern: /(\w{15,}),\s/g,
    replace: (match, word) => `${word}, ... `,
    probability: 0.2,
  },
];

/**
 * Apply voice humanisms to text before sending to ElevenLabs.
 *
 * @param text - The raw text from Claude's response
 * @param intensity - How many humanisms to apply (0 = none, 1 = full)
 *                    Default 0.6 for a natural balance.
 * @returns Text with subtle human-like pauses and breathing marks
 */
export function humanize(text: string, intensity: number = 0.6): string {
  if (!text || text.trim().length < 10) return text;

  let result = text;
  let ruleIndex = 0;

  for (const rule of RULES) {
    // Scale probability by intensity
    const effectiveProbability = rule.probability * intensity;

    // Apply the rule with probability check
    let matchIndex = 0;
    result = result.replace(rule.pattern, (...args) => {
      const shouldApply = seededRandom(text, ruleIndex * 100 + matchIndex) < effectiveProbability;
      matchIndex++;

      if (shouldApply) {
        return rule.replace(...args);
      }
      return args[0]; // Return original match
    });

    ruleIndex++;
  }

  // Clean up: never have more than one ellipsis in a row
  result = result.replace(/(\.\.\.\s*){2,}/g, '... ');

  // Clean up: no ellipsis at the very start
  result = result.replace(/^\.\.\.\s*/, '');

  return result;
}

/**
 * Generate a soft acknowledgment sound for when Navia is processing.
 * Returns a short text that ElevenLabs will render as a natural "hm" sound.
 */
export function acknowledgment(): string {
  const sounds = ['Hm...', 'Mhm...', 'Mm...'];
  const index = Math.floor(Math.random() * sounds.length);
  return sounds[index];
}
