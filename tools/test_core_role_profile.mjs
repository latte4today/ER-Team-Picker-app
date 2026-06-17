if (!global.localStorage) {
  global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

if (!global.document) {
  global.document = {
    documentElement: {
      lang: "ko",
      dataset: {},
    },
  };
}

const { debugCoreRoleProfile, recommend } = await import("../src/recommender.js");

const cases = [
  {
    label: "Luke healing-drone",
    selected: ["luke:bat"],
    cores: { "luke:bat": "7200301" },
  },
  {
    label: "Luke retribution",
    selected: ["luke:bat"],
    cores: { "luke:bat": "7100501" },
  },
  {
    label: "Luke maelstrom",
    selected: ["luke:bat"],
    cores: { "luke:bat": "7300301" },
  },
  {
    label: "Mirka healing-drone",
    selected: ["mirka:hammer"],
    cores: { "mirka:hammer": "7200301" },
  },
  {
    label: "Mirka maelstrom",
    selected: ["mirka:hammer"],
    cores: { "mirka:hammer": "7300301" },
  },
  {
    label: "Sua ironclad",
    selected: ["sua:bat"],
    cores: { "sua:bat": "7100201" },
  },
  {
    label: "Sua maelstrom",
    selected: ["sua:bat"],
    cores: { "sua:bat": "7300301" },
  },
  {
    label: "Sho healing-drone",
    selected: ["sho:spear"],
    cores: { "sho:spear": "7200301" },
  },
  {
    label: "Sho amplification-drone",
    selected: ["sho:spear"],
    cores: { "sho:spear": "7200201" },
  },
];

for (const item of cases) {
  const debug = debugCoreRoleProfile(item.selected, item.cores, "all");
  const luke = debug.characters[0];
  const top = recommend(item.selected, "all", {}, undefined, [], item.cores)
    .slice(0, 5)
    .map((row) => `${row.character.variantId}:${row.total}`);

  console.log(`\n=== ${item.label} ===`);
  console.log(`core=${luke.effectiveCore?.core ?? "-"} role=${luke.role} damage=${luke.damage} frontDamage=${luke.frontDamage}`);
  console.log(`shape=tanks:${debug.shape.tanks} melee:${debug.shape.melee} backline:${debug.shape.backline} supports:${debug.shape.supports}`);
  console.log(`tags=${luke.tags.join(",")}`);
  console.log(`top=${top.join(" | ")}`);
}
