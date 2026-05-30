// ─── bots.js ────────────────────────────────────────────────────────────────────
//
//  11 chess bot personalities (10 legends + pure Stockfish engine).
//
//  How it plugs into game.js / engine.js
//  ─────────────────────────────────────
//  • Call  activateBot(botId, playerColor)  to start a game vs a bot.
//    It writes  localStorage['botSettings']  and  window._botCfg  in the
//    shape engine.js expects:
//
//      {
//        active, playerColor, botId, name,
//        depth, skillLevel, mistakeRate,
//        elo, difficulty,
//        engineMode,          // "unlimited" | "elo_limited"
//        targetElo,           // used with UCI_LimitStrength when elo_limited
//        noRandomMoves,       // true → never inject blunders regardless of mistakeRate
//        uciOptions: {        // passed straight to Stockfish UCI
//          Contempt,          // +ve = aggressive/winning-oriented; -ve = drawish/positional
//          Skill_Level,       // 0–20 (maps to UCI "Skill Level")
//        },
//        openingLines,        // string[][] — preferred opening move sequences (UCI long-algebraic)
//        styleWeights: {      // engine.js can nudge move selection with these
//          pawnAdvance,       // weight for pawn-push moves
//          pieceActivity,     // weight for activating pieces
//          kingSafety,        // weight for king safety evaluation
//          attackKing,        // weight for king-attack moves
//          endgameConversion, // weight for simplification / technique
//        }
//      }
//
//  • engine.js MUST:
//      - Read  window._botCfg.uciOptions  and forward each key to Stockfish (setoption)
//      - When engineMode === "unlimited": do NOT set UCI_LimitStrength at all.
//        Use Skill Level 20 + the supplied depth. This is what makes Stockfish
//        truly unbeatable — any artificial strength cap will make it beatable.
//      - When engineMode === "elo_limited": set UCI_LimitStrength true and
//        UCI_Elo = targetElo, then ALSO set Skill Level = uciOptions.Skill_Level.
//      - NEVER call Math.random() blunder injection when noRandomMoves === true.
//        mistakeRate on those bots is kept for legacy safety but must be ignored.
//
//  • Call  deactivateBot()  to clear and return to human-vs-human mode.
//  • getBotById(id)  returns the full bot descriptor for UI rendering.
//  • BOTS  is exported on  window  for any other script that needs the list.
//
// ────────────────────────────────────────────────────────────────────────────────

const BOTS = [

  // ── 1 ── Philidor ────────────────────────────────────────────────────────────
  {
    id: "philidor",
    name: "Philidor",
    fullName: "François-André Philidor",
    years: "1726 – 1795",
    title: "The Pawn Philosopher",
    avatar: "♟️",
    difficulty: 1,
    elo: 2000,
    eloNote: "est.",

    // Engine config
    depth: 1,
    skillLevel: 1,
    mistakeRate: 0.55,
    engineMode: "elo_limited",
    targetElo: 1400,
    noRandomMoves: false,

    uciOptions: {
      Contempt: 0,        // no strong feelings — just push pawns
      Skill_Level: 1,
    },

    // Opening preference: e4 e5 d3 — slow, block own bishops, Philidor setup
    openingLines: [
      ["e2e4", "e7e5", "d2d3", "d7d6"],
      ["d2d4", "d7d5", "e2e3"],
    ],

    styleWeights: {
      pawnAdvance:      2.0,   // loves pushing pawns
      pieceActivity:    0.2,   // terrible at developing
      kingSafety:       0.4,   // doesn't prioritize castling
      attackKing:       0.2,
      endgameConversion: 0.3,
    },

    description: "Philidor famously said pawns are the soul of chess — and he proves it every game. He pushes pawns relentlessly, forgets to develop his pieces, and hands you free tactics. Your very first opponent.",
    playstyle: ["Pawn-pusher", "Passive", "Slow developer"],
    favoriteOpenings: ["Philidor Defense (e4 e5 d6)", "King's Pawn (e4 e5 d3)"],
    personality: {
      prefersOpenFiles: false,
      avoidsExchanges: true,
      pawnStructurePriority: 0.9,
      tacticalAwareness: 0.1,
      endgameStrength: 0.2,
    },
    weaknesses: [
      "Delays castling — kingside attacks work well",
      "Blocks own bishops with pawns",
      "Misses forks and pins completely",
    ],
    quote: "Pawns are the soul of chess. My pieces? They can wait.",
  },

  // ── 2 ── Morphy ───────────────────────────────────────────────────────────────
  {
    id: "morphy",
    name: "Morphy",
    fullName: "Paul Morphy",
    years: "1837 – 1884",
    title: "The Pride & Sorrow of Chess",
    avatar: "⚔️",
    difficulty: 2,
    elo: 2690,
    eloNote: "est.",

    // Engine config
    // Morphy was genuinely ~2600+ retroactively — make him feel it.
    // He blitzed through development and attacked relentlessly;
    // model that with high Contempt and aggressive opening lines.
    depth: 3,
    skillLevel: 6,
    mistakeRate: 0.18,
    engineMode: "elo_limited",
    targetElo: 2100,
    noRandomMoves: false,

    uciOptions: {
      Contempt: 60,       // very aggressive — always playing for the win
      Skill_Level: 6,
    },

    // King's Gambit, Italian, Ruy López — open attacking games only
    openingLines: [
      ["e2e4", "e7e5", "f2f4"],                       // King's Gambit
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"],       // Italian
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],       // Ruy López
      ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4"],       // Scotch Game
    ],

    styleWeights: {
      pawnAdvance:      0.8,
      pieceActivity:    2.0,   // rapid development above all
      kingSafety:       0.9,   // castles early, then launches
      attackKing:       1.8,   // goes for the king relentlessly
      endgameConversion: 0.3,  // weak endgames — doesn't simplify
    },

    description: "The romantic genius of chess. Morphy develops with lightning speed and attacks with everything — bishops, knights, rooks all bearing down on the king. If you survive the opening storm, he loses steam. If you don't develop fast, you'll be mated by move 20.",
    playstyle: ["Aggressive", "Open games", "Piece sacrificer"],
    favoriteOpenings: ["King's Gambit (e4 e5 f4)", "Italian Game", "Ruy López", "Scotch Game"],
    personality: {
      prefersOpenFiles: true,
      avoidsExchanges: false,
      pawnStructurePriority: 0.3,
      tacticalAwareness: 0.65,
      endgameStrength: 0.25,
    },
    weaknesses: [
      "Counterattack on the queenside when his kingside attack stalls",
      "Declines gambits — he thrives in open positions",
      "Endgames are his weakness if you survive the middlegame",
    ],
    quote: "Help your pieces so they can help you. Then attack everything.",
  },

  // ── 3 ── Steinitz ─────────────────────────────────────────────────────────────
  {
    id: "steinitz",
    name: "Steinitz",
    fullName: "Wilhelm Steinitz",
    years: "1836 – 1900",
    title: "The First World Champion",
    avatar: "🏛️",
    difficulty: 3,
    elo: 2530,
    eloNote: "est.",

    // Steinitz invented positional chess — accumulate small advantages,
    // defend stubbornly, never attack until fully prepared.
    depth: 4,
    skillLevel: 9,
    mistakeRate: 0.10,
    engineMode: "elo_limited",
    targetElo: 2300,
    noRandomMoves: false,

    uciOptions: {
      Contempt: -15,      // slightly drawish/positional — no speculative attacks
      Skill_Level: 9,
    },

    openingLines: [
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "d7d6"],  // Steinitz Ruy López
      ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3"],            // Queen's Gambit Declined
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "c2c3"], // Giuoco Pianissimo
    ],

    styleWeights: {
      pawnAdvance:      1.4,
      pieceActivity:    1.0,
      kingSafety:       1.6,   // prioritizes safety and solid structure
      attackKing:       0.5,   // only attacks when the position fully justifies it
      endgameConversion: 1.3,
    },

    description: "Steinitz invented positional chess and was the first official World Champion. He accumulates microscopic advantages, defends stubbornly, and only launches attacks when every piece is perfectly placed. He won't blunder, and the grip tightens move by move.",
    playstyle: ["Positional", "Defensive", "Methodical"],
    favoriteOpenings: ["Steinitz Variation (Ruy López)", "Queen's Gambit Declined", "Giuoco Pianissimo"],
    personality: {
      prefersOpenFiles: false,
      avoidsExchanges: false,
      pawnStructurePriority: 0.8,
      tacticalAwareness: 0.5,
      endgameStrength: 0.7,
    },
    weaknesses: [
      "Seize the initiative and don't let him settle",
      "Sharp tactical complications make him uncomfortable",
      "He's slow to castle — generate threats in the opening",
    ],
    quote: "A win by attack is only valid if the attack was the most logical move.",
  },

  // ── 4 ── Lasker ───────────────────────────────────────────────────────────────
  {
    id: "lasker",
    name: "Lasker",
    fullName: "Emanuel Lasker",
    years: "1868 – 1941",
    title: "The Pragmatic Champion",
    avatar: "🎭",
    difficulty: 4,
    elo: 2625,
    eloNote: "est.",

    // Lasker deliberately avoided the objectively best moves to
    // unsettle opponents. High Contempt + some injected chaos.
    depth: 5,
    skillLevel: 11,
    mistakeRate: 0.06,
    engineMode: "elo_limited",
    targetElo: 2450,
    noRandomMoves: false,

    uciOptions: {
      Contempt: 35,       // always fighting for the win, never content with draws
      Skill_Level: 11,
    },

    openingLines: [
      ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "g1f3", "f8e7", "f1g2"], // Lasker QGD
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "f8c5"],  // Berlin / Ruy
      ["e2e4", "c7c5"],                                    // Sicilian (complications)
    ],

    styleWeights: {
      pawnAdvance:      0.9,
      pieceActivity:    1.2,
      kingSafety:       1.0,
      attackKing:       1.1,
      endgameConversion: 1.4,  // famously great endgame technique
    },

    description: "World Champion for 27 years — longer than anyone in history. Lasker was a fighter who deliberately complicated positions to unsettle opponents. He'll make objectively imperfect moves to throw you off. Stay calm and calculate; he thrives when you panic.",
    playstyle: ["Practical", "Psychological", "Fighter"],
    favoriteOpenings: ["Lasker Defense (QGD)", "Berlin Defense", "Sicilian complications"],
    personality: {
      prefersOpenFiles: true,
      avoidsExchanges: false,
      pawnStructurePriority: 0.5,
      tacticalAwareness: 0.65,
      endgameStrength: 0.80,
    },
    weaknesses: [
      "Stay calm in complications — he wants you to panic",
      "Clean, quiet positions where technique dominates",
      "Avoid giving him the pawn weaknesses he likes to exploit",
    ],
    quote: "When in doubt, play the move your opponent wants you to avoid.",
  },

  // ── 5 ── Capablanca ───────────────────────────────────────────────────────────
  {
    id: "capablanca",
    name: "Capablanca",
    fullName: "José Raúl Capablanca",
    years: "1888 – 1942",
    title: "The Chess Machine",
    avatar: "⚙️",
    difficulty: 5,
    elo: 2725,
    eloNote: "est.",

    // Capablanca played effortless, clean chess — always the most
    // logical continuation, brilliant endgame technique, near-zero blunders.
    depth: 7,
    skillLevel: 14,
    mistakeRate: 0.02,
    engineMode: "elo_limited",
    targetElo: 2600,
    noRandomMoves: true,   // Capablanca simply did not blunder

    uciOptions: {
      Contempt: 10,       // calm confidence — plays for the win but cleanly
      Skill_Level: 14,
    },

    openingLines: [
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],           // Ruy López classical
      ["d2d4", "d7d5", "c2c4", "d5c4"],                   // QGA / Exchange
      ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "g1f3"], // QGD
      ["c2c4"],                                             // English
    ],

    styleWeights: {
      pawnAdvance:      0.9,
      pieceActivity:    1.2,
      kingSafety:       1.1,
      attackKing:       0.8,
      endgameConversion: 2.0,  // the endgame maestro — always simplifies to +
    },

    description: "Effortless, clean, and clinical. Capablanca reaches endgames with a tiny edge and converts without fail — his technique is considered the best in chess history. His games look simple. That's the trap. Avoid exchanges and keep the position complicated.",
    playstyle: ["Technical", "Endgame maestro", "Flawless"],
    favoriteOpenings: ["Ruy López (Classical)", "Queen's Gambit", "English Opening"],
    personality: {
      prefersOpenFiles: true,
      avoidsExchanges: false,
      pawnStructurePriority: 0.80,
      tacticalAwareness: 0.70,
      endgameStrength: 0.97,
    },
    weaknesses: [
      "Avoid simplified endgames — keep as many pieces on the board as possible",
      "Mutual king attacks where calculation beats technique",
      "Sacrificial complications he can't easily calculate",
    ],
    quote: "Chess is not about passion — it is about logic, clarity, and precision.",
  },

  // ── 6 ── Tal ──────────────────────────────────────────────────────────────────
  {
    id: "tal",
    name: "Tal",
    fullName: "Mikhail Tal",
    years: "1936 – 1992",
    title: "The Magician from Riga",
    avatar: "🔮",
    difficulty: 6,
    elo: 2705,
    eloNote: "peak",

    // Tal is the ultimate attacking genius. Maximum Contempt, attacking lines,
    // sacrifices everything for king attacks. He was genuinely around 2700+
    // FIDE — model that strength while forcing his chaotic attacking style.
    depth: 8,
    skillLevel: 15,
    mistakeRate: 0.01,
    engineMode: "elo_limited",
    targetElo: 2700,
    noRandomMoves: true,   // his "mistakes" were intentional sacrifices, not blunders

    uciOptions: {
      Contempt: 120,      // extremely aggressive — sacrifices pieces freely for attack
      Skill_Level: 15,
    },

    // Sicilian Najdorf, King's Indian, sharp gambits — always open attacking games
    openingLines: [
      ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"], // Najdorf
      ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "f8g7", "e2e4", "d7d6"],  // King's Indian
      ["e2e4", "e7e5", "f2f4"],                                             // King's Gambit
      ["e2e4", "c7c5", "g1f3", "b8c6", "d2d4", "c5d4", "f3d4", "g7g6"],  // Accelerated Dragon
    ],

    styleWeights: {
      pawnAdvance:      0.6,
      pieceActivity:    1.5,
      kingSafety:       0.4,   // ignores own king safety in pursuit of attack
      attackKing:       2.5,   // MAXIMUM weight on king attacks
      endgameConversion: 0.5,  // poor endgames — wants to end it in the middlegame
    },

    description: "The Magician from Riga sacrificed pieces like others sacrifice pawns. His attacks are wild, brilliant, and frequently unsound by computer standards — but nearly impossible to defend over the board. He was World Champion and peak-rated 2705. Surviving his onslaught requires perfect play.",
    playstyle: ["Sacrificial", "Attacking", "Chaotic genius"],
    favoriteOpenings: ["Sicilian Najdorf", "King's Indian Defense", "King's Gambit"],
    personality: {
      prefersOpenFiles: true,
      avoidsExchanges: false,
      pawnStructurePriority: 0.2,
      tacticalAwareness: 0.92,
      endgameStrength: 0.55,
    },
    weaknesses: [
      "Refuse his sacrifices and return material when the position stabilises",
      "Patient, defensive play can neutralise his attacks — then counterattack",
      "Endgames without tactics are his real weakness",
    ],
    quote: "You must take your opponent into a deep dark forest where 2+2=5, and the path leading out is only wide enough for one.",
  },

  // ── 7 ── Fischer ──────────────────────────────────────────────────────────────
  {
    id: "fischer",
    name: "Fischer",
    fullName: "Robert James Fischer",
    years: "1943 – 2008",
    title: "The Lone Genius",
    avatar: "🦅",
    difficulty: 7,
    elo: 2785,
    eloNote: "peak",

    // Fischer was the most complete player of his era — tactical sharpness,
    // positional understanding, endgame technique, relentless will to win.
    // Peak 2785 FIDE and retroactively estimated ~2880+ by some models.
    depth: 10,
    skillLevel: 17,
    mistakeRate: 0.003,
    engineMode: "elo_limited",
    targetElo: 2785,
    noRandomMoves: true,

    uciOptions: {
      Contempt: 45,       // always plays for the win — refused draws on principle
      Skill_Level: 17,
    },

    openingLines: [
      ["e2e4", "e7e5", "f2f4"],                                              // King's Gambit (Fischer loved this)
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],                             // Ruy López
      ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"], // Najdorf as Black
      ["e2e4"],                                                               // 1.e4 — Fischer's exclusive weapon as White
    ],

    styleWeights: {
      pawnAdvance:      1.1,
      pieceActivity:    1.6,
      kingSafety:       1.3,
      attackKing:       1.5,
      endgameConversion: 1.6,  // brilliant endgame — converts even R+P advantages
    },

    description: "The most dominant performance in World Championship history. Fischer played precise, deeply calculated chess in every phase — aggressive when attacking, technically immaculate in endgames. His 1972 peak was near-superhuman. He will find your weaknesses before you know they exist.",
    playstyle: ["Universal genius", "Precise calculation", "Dominant"],
    favoriteOpenings: ["1.e4 exclusively", "King's Gambit", "Ruy López", "Najdorf (Black)"],
    personality: {
      prefersOpenFiles: true,
      avoidsExchanges: false,
      pawnStructurePriority: 0.75,
      tacticalAwareness: 0.92,
      endgameStrength: 0.93,
    },
    weaknesses: [
      "Surprise him with rare sidelines — his prep was memorised, not improvised",
      "Unbalanced positions can occasionally disrupt his calculations",
      "Don't give him static advantages — keep the position dynamic",
    ],
    quote: "Chess is war over the board. The object is to crush the opponent's mind.",
  },

  // ── 8 ── Karpov ───────────────────────────────────────────────────────────────
  {
    id: "karpov",
    name: "Karpov",
    fullName: "Anatoly Karpov",
    years: "1951 – present",
    title: "The Boa Constrictor",
    avatar: "🐍",
    difficulty: 8,
    elo: 2780,
    eloNote: "peak",

    // Karpov's genius was quiet, inevitable positional pressure.
    // Low contempt (slightly drawish in style), but maximum technical
    // accuracy. He wins by suffocation — you never see the decisive blow.
    depth: 12,
    skillLevel: 18,
    mistakeRate: 0.001,
    engineMode: "elo_limited",
    targetElo: 2780,
    noRandomMoves: true,

    uciOptions: {
      Contempt: -5,       // slightly drawish in style — wins by technique not aggression
      Skill_Level: 18,
    },

    openingLines: [
      ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4"],  // Nimzo-Indian
      ["e2e4", "c7c6"],                                     // Caro-Kann (as Black — Karpov's weapon)
      ["d2d4", "d7d5", "c2c4", "e7e6"],                   // QGD
      ["c2c4", "g8f6", "b1c3"],                            // English Opening
    ],

    styleWeights: {
      pawnAdvance:      1.2,
      pieceActivity:    1.4,
      kingSafety:       1.5,
      attackKing:       0.9,
      endgameConversion: 1.9,  // legendary endgame precision — rook endings especially
    },

    description: "Karpov squeezes. He takes your space, restricts your pieces one by one, and tightens the grip until there's no air left. His positional understanding is arguably the finest in chess history. You won't see the decisive blow coming — by then it's already over.",
    playstyle: ["Positional", "Suffocating", "Prophylactic"],
    favoriteOpenings: ["Caro-Kann (Black)", "Nimzo-Indian", "Queen's Gambit Declined", "English"],
    personality: {
      prefersOpenFiles: false,
      avoidsExchanges: true,
      pawnStructurePriority: 0.95,
      tacticalAwareness: 0.82,
      endgameStrength: 0.97,
    },
    weaknesses: [
      "Stay active and counter-attack — passivity is fatal against him",
      "Force sharp, double-edged positions where intuition beats technique",
      "Sacrifice a pawn for dynamic counterplay — he hates chaotic structures",
    ],
    quote: "Chess is everything — art, science, and sport. And I intend to win it all.",
  },

  // ── 9 ── Kasparov ─────────────────────────────────────────────────────────────
  {
    id: "kasparov",
    name: "Kasparov",
    fullName: "Garry Kasparov",
    years: "1963 – present",
    title: "The Beast of Baku",
    avatar: "🔥",
    difficulty: 9,
    elo: 2851,
    eloNote: "peak",

    // Kasparov combined Tal's aggression with Fischer's precision and
    // Karpov's preparation. Peak 2851 — world record at the time.
    // Very high Contempt + deep home preparation in complex lines.
    depth: 15,
    skillLevel: 19,
    mistakeRate: 0.0005,
    engineMode: "elo_limited",
    targetElo: 2851,
    noRandomMoves: true,

    uciOptions: {
      Contempt: 85,       // ferocious will to win — hated draws
      Skill_Level: 19,
    },

    openingLines: [
      ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"], // Najdorf (both colours)
      ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "f8g7", "e2e4", "d7d6", "g1f3"], // King's Indian
      ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "d7d5"],  // Grünfeld
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],           // Ruy López (aggressive lines)
    ],

    styleWeights: {
      pawnAdvance:      1.3,
      pieceActivity:    1.8,
      kingSafety:       1.1,
      attackKing:       2.0,   // devastating king-side attacks
      endgameConversion: 1.7,
    },

    description: "The greatest chess player of the 20th century. Kasparov combines Tal's attacking fury with Fischer's calculation depth and Karpov's positional mastery. His preparation was decades ahead of everyone. His middlegames are a hurricane — you will need to play the best moves of your life.",
    playstyle: ["Dynamic", "Ferociously aggressive", "Deeply prepared"],
    favoriteOpenings: ["Sicilian Najdorf", "King's Indian Defense", "Grünfeld"],
    personality: {
      prefersOpenFiles: true,
      avoidsExchanges: false,
      pawnStructurePriority: 0.70,
      tacticalAwareness: 0.97,
      endgameStrength: 0.95,
    },
    weaknesses: [
      "Nearly none — play your absolute best chess",
      "Incredibly rare: he can occasionally overattack — defend tenaciously and counter",
      "Quiet, technical endgames give you a slightly better chance than sharp middlegames",
    ],
    quote: "Ultimately, what separates a winner from a loser is how they respond to each new twist of fate.",
  },

  // ── 10 ── Carlsen ─────────────────────────────────────────────────────────────
  {
    id: "carlsen",
    name: "Carlsen",
    fullName: "Magnus Carlsen",
    years: "1990 – present",
    title: "The Mozart of Chess",
    avatar: "👑",
    difficulty: 10,
    elo: 2882,
    eloNote: "peak",

    // Carlsen's record 2882 FIDE peak. He is the most complete player
    // in chess history — deep opening preparation, tactical brilliance,
    // supernatural endgame technique, and relentless pressure in all phases.
    // Using UCI_LimitStrength with his peak ELO still produces near-perfect play.
    depth: 18,
    skillLevel: 20,
    mistakeRate: 0.0,
    engineMode: "elo_limited",
    targetElo: 2882,
    noRandomMoves: true,

    uciOptions: {
      Contempt: 30,       // plays for wins in every endgame; draws are failure
      Skill_Level: 20,
    },

    openingLines: [
      ["e2e4"],            // flexible — Carlsen wins with everything
      ["d2d4"],
      ["c2c4"],
      ["g1f3"],            // often starts with Nf3 to keep options open
    ],

    styleWeights: {
      pawnAdvance:      1.1,
      pieceActivity:    1.5,
      kingSafety:       1.4,
      attackKing:       1.4,
      endgameConversion: 2.0,  // the greatest endgame player who has ever lived
    },

    description: "World Champion for over a decade and the highest-rated player in history. Carlsen plays perfectly in every phase — openings, middlegames, endgames, rapid, blitz. He squeezes endgames that grandmasters would draw without a second thought. There is no phase of the game where you are safe.",
    playstyle: ["Universal", "Endgame god", "Relentless pressure"],
    favoriteOpenings: ["Everything — he wins with any opening"],
    personality: {
      prefersOpenFiles: true,
      avoidsExchanges: false,
      pawnStructurePriority: 0.85,
      tacticalAwareness: 0.99,
      endgameStrength: 1.00,
    },
    weaknesses: [
      "There are none. Survive as long as possible.",
    ],
    quote: "Some people think that if their opponent plays a beautiful game, it's okay to lose. I don't. I hate to lose.",
  },

  // ── 11 ── Stockfish ───────────────────────────────────────────────────────────
  {
    id: "stockfish",
    name: "Stockfish",
    fullName: "Stockfish Engine",
    years: "2008 – present",
    title: "The Unchained Engine",
    avatar: "🤖",
    difficulty: 11,
    elo: 3200,
    eloNote: "engine",

    // CRITICAL: engineMode "unlimited" tells engine.js to NOT set UCI_LimitStrength
    // at all. This is the only way to get true 3200+ engine strength.
    // Any artificial ELO cap will introduce solvable patterns.
    // Skill Level 20 + no strength limit + deep search = genuinely unbeatable.
    depth: 22,
    skillLevel: 20,
    mistakeRate: 0.0,
    engineMode: "unlimited",   // <-- NO artificial ELO cap whatsoever
    targetElo: null,           // ignored when engineMode === "unlimited"
    noRandomMoves: true,       // NEVER inject random moves — ever

    uciOptions: {
      Contempt: 20,       // slight winning tendency — always plays for the result
      Skill_Level: 20,    // maximum — no skill degradation
      // engine.js MUST NOT set UCI_LimitStrength when engineMode === "unlimited"
    },

    openingLines: [],     // no opening preference — plays objectively best moves

    styleWeights: {
      pawnAdvance:      1.0,
      pieceActivity:    1.0,
      kingSafety:       1.0,
      attackKing:       1.0,
      endgameConversion: 1.0,  // plays best in every phase
    },

    description: "The raw engine — no personality, no playstyle, no mercy. Stockfish at full strength plays at approximately 3500+ CCRL Elo. It has no weaknesses, makes no mistakes, and calculates 200 million positions per second. This is not a challenge. It is a lesson in humility.",
    playstyle: ["Omniscient", "Merciless", "Perfect"],
    favoriteOpenings: ["Objectively best continuation from any position"],
    personality: {
      prefersOpenFiles: true,
      avoidsExchanges: false,
      pawnStructurePriority: 1.0,
      tacticalAwareness: 1.0,
      endgameStrength: 1.0,
    },
    weaknesses: [
      "None.",
    ],
    quote: "depth 22 · nodes 200M/s · eval: +∞",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getBotById(id) {
  return BOTS.find(b => b.id === id);
}

function activateBot(botId, playerColor = 'w') {
  const bot = getBotById(botId);
  if (!bot) { console.error(`[bots.js] Unknown bot id: "${botId}"`); return; }
  // ── Clear stale online room so online.js doesn't stomp bot config ──
  localStorage.removeItem('onlineRoom');  
  const settings = {
    active:         true,
    playerColor:    playerColor,
    botColor:       playerColor === 'b' ? 'w' : 'b',  // bot plays the opposite colour
    botId:          bot.id,
    name:           bot.name,

    // Core engine params
    depth:          bot.depth,
    skillLevel:     bot.skillLevel,
    mistakeRate:    bot.mistakeRate,
    elo:            bot.elo,
    difficulty:     bot.difficulty,

    // Strength mode — engine.js MUST respect engineMode
    engineMode:     bot.engineMode,    // "unlimited" | "elo_limited"
    targetElo:      bot.targetElo,     // null when unlimited
    noRandomMoves:  bot.noRandomMoves, // if true, never inject random moves

    // Stockfish UCI options — engine.js forwards these via setoption
    uciOptions:     bot.uciOptions,

    // Playstyle weights — engine.js can use for move selection bias
    openingLines:   bot.openingLines,
    styleWeights:   bot.styleWeights,
  };

  try {
    localStorage.setItem('botSettings', JSON.stringify(settings));
  } catch(e) {
    console.error('[bots.js] Could not save bot settings to localStorage', e);
  }

  window._botCfg    = settings;
  window._botActive = true;
  window._playerCol = playerColor;
  window._flipped   = playerColor === 'b';

  console.log(
    `[bots.js] Activated: ${bot.name}` +
    ` | mode: ${bot.engineMode}` +
    (bot.targetElo ? ` | target ELO: ${bot.targetElo}` : ' | UNLIMITED STRENGTH') +
    ` | depth: ${bot.depth}` +
    ` | skill: ${bot.skillLevel}` +
    ` | contempt: ${bot.uciOptions.Contempt}`
  );

  return settings;
}

function deactivateBot() {
  try { localStorage.removeItem('botSettings'); } catch(e) {}
  window._botCfg    = null;
  window._botActive = false;
  window._playerCol = null;
  window._flipped   = false;
}

window.BOTS          = BOTS;
window.getBotById    = getBotById;
window.activateBot   = activateBot;
window.deactivateBot = deactivateBot;
