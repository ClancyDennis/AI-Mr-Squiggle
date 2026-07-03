// Concept-seed theory (github.com/ClancyDennis/concept-seed): LLMs are comically
// bad at being random or diverse on their own, so they mode-collapse onto a favorite
// reading of an open-ended prompt (here: "everything is a whale"). The fix is to
// externalize the randomness — draw words the model did NOT choose and drop them in as
// a gentle "inspiration:" line. The words are arbitrary on purpose: they are not
// thematic guidance, just an unpredictable nudge that throws the model off its default
// path. A broad, mixed vocabulary (objects, moods, actions, abstractions — anything)
// works precisely because it's unpredictable. Each is picked with a crypto RNG (the
// os.urandom analog) instead of asking the model to choose.
export const CONCEPT_SEED_WORDS = [
  // objects & contraptions
  "lantern", "umbrella", "teapot", "anchor", "compass", "telescope", "accordion",
  "typewriter", "hourglass", "kettle", "lighthouse", "windmill", "mailbox", "kite",
  "ladder", "wheelbarrow", "sundial", "periscope", "gramophone", "chandelier",
  "birdcage", "harmonica", "kaleidoscope", "weathervane", "pinwheel", "clockwork",
  "fountain", "carousel", "dreamcatcher", "marionette",
  // vehicles
  "submarine", "tractor", "gondola", "rocket", "biplane", "tugboat", "unicycle",
  "zeppelin", "locomotive", "sailboat", "hot-air balloon",
  // nature & landscape
  "volcano", "waterfall", "glacier", "canyon", "cactus", "mushroom", "coral",
  "geyser", "tumbleweed", "iceberg", "whirlpool", "meteor", "aurora", "fjord",
  "sand dune", "hot spring",
  // weather
  "thundercloud", "snowflake", "tornado", "rainbow", "monsoon",
  // food
  "pretzel", "cupcake", "pineapple", "croissant", "noodle", "lollipop", "artichoke",
  "dumpling", "popsicle", "gumball",
  // architecture
  "pagoda", "drawbridge", "aqueduct", "igloo", "treehouse", "observatory",
  "ferris wheel", "totem", "obelisk", "greenhouse",
  // music & art
  "cello", "bagpipe", "xylophone", "tambourine", "easel", "metronome", "megaphone",
  "origami",
  // mythical & fantastical
  "dragon", "golem", "phoenix", "mermaid", "gargoyle", "robot", "alien", "wizard",
  "knight", "jester", "scarecrow", "yeti", "kraken",
  // characters & professions
  "astronaut", "deep-sea diver", "beekeeper", "chef", "conductor", "lighthouse keeper",
  // abstract & physical concepts
  "gravity", "nostalgia", "momentum", "symmetry", "echo", "labyrinth", "eclipse",
  "vertigo", "mirage",
  // creatures (kept a deliberate minority, none whale-shaped)
  "platypus", "narwhal", "axolotl", "pangolin", "chameleon", "octopus", "hedgehog",
  "flamingo", "seahorse", "beetle", "jellyfish", "snail", "peacock", "walrus",
  "sloth", "toucan", "hummingbird",
  // moods
  "wistful", "giddy", "smug", "serene", "mischievous", "melancholy", "triumphant",
  "cozy", "anxious", "dreamy", "bashful", "defiant", "tender", "grumpy", "hopeful",
  "playful", "solemn", "curious", "restless", "bewildered", "brave", "electric",
  "whimsical", "fierce", "smitten",
  // actions & energies
  "tumbling", "sprouting", "balancing", "unraveling", "drifting", "colliding",
  "blooming", "teetering", "spiraling", "hatching", "melting", "leaping", "stretching",
  "floating", "tiptoeing", "spinning", "wobbling", "erupting", "gliding", "crumbling",
  "swirling", "climbing", "peeking", "toppling",
];

// Crypto-random index so the choice comes from outside any model's probability
// distribution (concept-seed's core requirement). Also reused by the ideation
// picker, which selects among model-proposed squiggle subjects in code.
export function secureRandomIndex(total: number): number {
  if (total <= 1) return 0;
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    // Rejection-sample to avoid modulo bias against an unbiased index.
    const limit = Math.floor(0xffffffff / total) * total;
    const buf = new Uint32Array(1);
    let value = limit;
    while (value >= limit) {
      crypto.getRandomValues(buf);
      value = buf[0];
    }
    return value % total;
  }
  return Math.floor(Math.random() * total);
}

// Pick `count` distinct seeds.
export function drawConceptSeeds(count = 3): string[] {
  const total = CONCEPT_SEED_WORDS.length;
  const wanted = Math.min(count, total);
  const picked = new Set<number>();

  while (picked.size < wanted) {
    picked.add(secureRandomIndex(total));
  }

  return Array.from(picked, (index) => CONCEPT_SEED_WORDS[index]);
}
