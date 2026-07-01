// Concept-seed theory (github.com/ClancyDennis/concept-seed): LLMs are comically
// bad at being random or diverse on their own, so they mode-collapse onto a favorite
// reading of an open-ended prompt (here: "everything is a whale"). The fix is to
// externalize the randomness — draw a concrete real-world word from outside the model
// and inject it into the *user* message as a plot twist. The word is the seed; we pick
// it with a crypto RNG (the os.urandom analog) instead of asking the model to choose.
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
];

// Pick `count` distinct seeds using crypto randomness so the choice comes from
// outside any model's probability distribution (concept-seed's core requirement).
export function drawConceptSeeds(count: number): string[] {
  const total = CONCEPT_SEED_WORDS.length;
  const wanted = Math.min(count, total);
  const picked = new Set<number>();

  const randomIndex = () => {
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
  };

  while (picked.size < wanted) {
    picked.add(randomIndex());
  }

  return Array.from(picked, (index) => CONCEPT_SEED_WORDS[index]);
}
