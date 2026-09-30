/* Outpace word banks, grouped by difficulty tier. Loaded as a classic script and via require() in tests. */
(function (root) {
  const split = (s) => s.trim().split(/\s+/);

  // Tier 1: short, very common, home-row friendly.
  const t1 = split(`
    a an as at be by do go he if in is it me my no of on or so to up us we
    the and for are but not you all any can had her was one our out day get
    has him his how man new now old see two way who boy did its let put say
    she too use run sun fun red big top hot dog cat sit ask add end far few
    got own set try yes yet ago air art bag bed box car cup cut eat eye fly
    job key law lay leg lie lot map mix oil pay pen pie sea sky tea ten war
    win arm act age aid bit buy fix fit fan gas hat ice kid lab mad net pan
    pet pop raw row sad tag tie tip toy van web wet zip also back been call
    come each even find from give good have here into just know like long
    make many more most much must name only over part said same some such
    take than that them then they this time very want well went were what
    when will with word work year your fast slow calm tide wave sand
  `);

  // Tier 2: everyday words, 4 to 6 letters.
  const t2 = split(`
    about after again below could every first found great house large learn
    never other place plant point right small sound spell still study their
    there these thing think three water where which while world would write
    light night might story young above along began being black bring build
    carry child close color cover cross early earth enemy field final floor
    force front given green group happy heard heart heavy horse human known
    later laugh level money month music often order paper party peace piece
    power quick quiet radio reach ready river round score seven shape share
    short sight since skill sleep smile solid space speed spend stand start
    state stone storm sugar table teach thank today total touch train truth
    under until upper value voice watch wheel whole woman wrong yellow ocean
    rhythm pocket garden silver planet window simple rocket forest bridge
    castle dragon flight rabbit marble winter summer spring autumn frozen
    candle island travel wonder moment motion beyond basket circle famous
    finger flower friend handle hidden jungle ladder mirror orange pepper
    puzzle ribbon saddle secret shadow signal smooth stripe stream sudden
    switch thread ticket tunnel velvet wander wizard yellow zipper breeze
  `);

  // Tier 3: longer words with trickier letter combinations.
  const t3 = split(`
    absolute accelerate adventure afternoon algorithm ambitious aquarium
    atmosphere avalanche backwards beautiful blueprint boulevard butterfly
    calculate carnival celebrate chemistry chocolate classroom commitment
    community companion comparison compass complicated concentrate confident
    constellation conversation courageous crystalline curiosity dangerous
    daydream delicious determined dimension discovery distance economy
    electric elephant elevator emergency encourage enormous equation escape
    evolution excellent explosion extraordinary fantastic fascinating
    festival formula frequency galaxy generous geography glacier gravity
    guitar harmony harvest horizon hurricane imagination incredible infinity
    instrument interesting invisible jellyfish journey kaleidoscope keyboard
    knowledge labyrinth landscape language lighthouse lightning magnificent
    marathon mechanism melody microphone midnight momentum mountain mystery
    navigation neighborhood notebook nucleus observatory orchestra outrageous
    paragraph parallel particle passenger phenomenon philosophy photograph
    pineapple possibility precision pyramid quarterback quicksilver
    reflection remarkable restaurant satellite schedule scientific sequence
    silhouette skyscraper spectacular strawberry submarine sunflower
    symphony telescope temperature thunderstorm tournament tranquility
    treasure triangle umbrella universe vocabulary volcano waterfall
    whirlpool wilderness xylophone yesterday zeppelin
  `);

  // Tier 6 extras: words that are awkward to type fast.
  const hard = split(`
    quixotic syzygy rhythmically zephyr onyx sphinx fjord jukebox buzzword
    squawk mnemonic pneumonia psychology bureaucracy entrepreneur
    conscientious idiosyncrasy onomatopoeia chrysanthemum questionnaire
    liaison millennium accommodate occurrence rendezvous silhouette
    exquisite juxtapose kerfuffle flabbergast hullabaloo pizzazz
    bamboozle quizzical wristwatch twelfth strengths awkward jazzy
    xenon quartz zigzag lynx sphynx crypt glyph nymph tsunami
  `);

  const symbols = ['()', '[]', '{}', '<>', '""', "''"];
  const punct = [',', ',', ',', '.', '.', '!', '?', ';', ':'];

  // Mulberry32: tiny seeded PRNG so runs are reproducible in tests.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const cap = (w) => w[0].toUpperCase() + w.slice(1);

  // Tier for a given chase level. Levels climb every 20 words.
  function tierForLevel(level) {
    if (level <= 1) return 1;
    if (level <= 2) return 2;
    if (level <= 3) return 3;
    if (level <= 5) return 4;
    if (level <= 7) return 5;
    return 6;
  }

  // Produce one word for a tier. `prev` is the previous word so we never repeat.
  function makeWord(r, tier, prev) {
    let w;
    for (let i = 0; i < 6; i++) {
      w = baseWord(r, tier);
      if (w !== prev) break;
    }
    return decorate(r, tier, w);
  }

  function baseWord(r, tier) {
    const x = r();
    switch (tier) {
      case 1: return pick(r, t1);
      case 2: return x < 0.4 ? pick(r, t1) : pick(r, t2);
      case 3: return x < 0.2 ? pick(r, t1) : x < 0.7 ? pick(r, t2) : pick(r, t3);
      case 4: return x < 0.15 ? pick(r, t1) : x < 0.55 ? pick(r, t2) : pick(r, t3);
      case 5: return x < 0.4 ? pick(r, t2) : x < 0.85 ? pick(r, t3) : pick(r, hard);
      default: return x < 0.3 ? pick(r, t2) : x < 0.7 ? pick(r, t3) : pick(r, hard);
    }
  }

  // Higher tiers add capitals, punctuation, numbers and symbols.
  function decorate(r, tier, w) {
    if (tier >= 4 && r() < 0.18) w = cap(w);
    if (tier >= 4 && r() < 0.16) w += pick(r, punct);
    if (tier >= 5 && r() < 0.08) return String(Math.floor(r() * (tier >= 6 ? 9999 : 99)) + 1);
    if (tier >= 6 && r() < 0.06) {
      const s = pick(r, symbols);
      w = s[0] + w + s[1];
    }
    if (tier >= 6 && r() < 0.04) w = w + '-' + pick(r, t1);
    return w;
  }

  const api = { rng, makeWord, tierForLevel, banks: { t1, t2, t3, hard } };
  root.OutpaceWords = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
