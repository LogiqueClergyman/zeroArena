/**
 * Inline-SVG cover art for the game tiles. No external image files — each thumbnail
 * is drawn to match its game's own art direction:
 *   · Connect4      → bright candy-arcade: purple board, glossy red/yellow discs, confetti
 *   · Sovereign Bluff → regal cinematic: burgundy vignette, gold gem, sealed bid cards
 * Gradient ids are namespaced per game so multiple thumbnails can coexist on one page.
 */

export function GameThumbnail({ gameId }: { gameId: string }) {
  if (gameId === "connect4") {
    return <Connect4Thumb />;
  }
  if (gameId === "sovereign-bluff") {
    return <SovereignBluffThumb />;
  }
  return <FallbackThumb gameId={gameId} />;
}

const svgProps = {
  className: "tile-thumb",
  viewBox: "0 0 400 150",
  preserveAspectRatio: "xMidYMid slice" as const,
  xmlns: "http://www.w3.org/2000/svg",
};

/* ============================ CONNECT 4 ============================ */

function Connect4Thumb() {
  // grid layout — 4 visible columns × 3 rows, with a believable mid-game fill
  const colsX = [152, 184, 216, 248];
  const rowsY = [62, 92, 122];
  // [top, middle, bottom] per column
  const fill: Array<Array<"r" | "y" | null>> = [
    [null, "y", "r"],
    [null, null, "y"],
    ["y", "r", "r"],
    [null, null, "y"],
  ];

  const confetti = [
    { x: 30, y: 26, c: "#fff", r: 2.4 },
    { x: 70, y: 60, c: "#fde047", r: 2 },
    { x: 48, y: 104, c: "#f472b6", r: 2.6 },
    { x: 350, y: 30, c: "#fff", r: 2.2 },
    { x: 322, y: 74, c: "#a78bfa", r: 2.4 },
    { x: 366, y: 110, c: "#fde047", r: 2 },
    { x: 110, y: 22, c: "#f472b6", r: 1.8 },
    { x: 300, y: 20, c: "#fff", r: 1.8 },
  ];

  return (
    <svg {...svgProps} role="img" aria-label="Connect4 cover art">
      <defs>
        <linearGradient id="c4t-sky" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.5" stopColor="#f0abfc" />
          <stop offset="1" stopColor="#8ec5ff" />
        </linearGradient>
        <radialGradient id="c4t-spot" cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="c4t-board" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#5b21b6" />
        </linearGradient>
        <radialGradient id="c4t-red" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffe1e1" />
          <stop offset="0.35" stopColor="#fca5a5" />
          <stop offset="0.7" stopColor="#ef4444" />
          <stop offset="1" stopColor="#991b1b" />
        </radialGradient>
        <radialGradient id="c4t-yellow" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.35" stopColor="#fde047" />
          <stop offset="0.7" stopColor="#f5a524" />
          <stop offset="1" stopColor="#92400e" />
        </radialGradient>
      </defs>

      <rect width="400" height="150" fill="url(#c4t-sky)" />
      <rect width="400" height="150" fill="url(#c4t-spot)" />

      {confetti.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c} opacity="0.85" />
      ))}

      {/* falling disc + motion trail */}
      <line x1="184" y1="6" x2="184" y2="30" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
      <circle cx="184" cy="34" r="11" fill="url(#c4t-red)" />
      <circle cx="180" cy="30" r="3.4" fill="#fff" opacity="0.75" />

      {/* board */}
      <g>
        <rect x="132" y="46" width="136" height="92" rx="16" fill="url(#c4t-board)" />
        <rect x="132" y="46" width="136" height="92" rx="16" fill="none" stroke="#a78bfa" strokeOpacity="0.35" strokeWidth="2" />
        {/* board legs */}
        <rect x="150" y="136" width="14" height="9" rx="3" fill="#4c1d95" />
        <rect x="236" y="136" width="14" height="9" rx="3" fill="#4c1d95" />
        {colsX.map((cx, ci) =>
          rowsY.map((cy, ri) => {
            const v = fill[ci][ri];
            const key = `${ci}-${ri}`;
            return (
              <g key={key}>
                <circle cx={cx} cy={cy} r="12.5" fill="#2e1065" />
                {v ? (
                  <>
                    <circle cx={cx} cy={cy} r="11" fill={v === "r" ? "url(#c4t-red)" : "url(#c4t-yellow)"} />
                    <circle cx={cx - 3.5} cy={cy - 3.5} r="2.6" fill="#fff" opacity="0.6" />
                  </>
                ) : null}
              </g>
            );
          }),
        )}
      </g>
    </svg>
  );
}

/* ============================ SOVEREIGN BLUFF ============================ */

function SovereignBluffThumb() {
  return (
    <svg {...svgProps} role="img" aria-label="Sovereign Bluff cover art">
      <defs>
        <radialGradient id="sbt-bg" cx="0.5" cy="0.32" r="0.9">
          <stop offset="0" stopColor="#3a1410" />
          <stop offset="0.55" stopColor="#240b12" />
          <stop offset="1" stopColor="#10060a" />
        </radialGradient>
        <radialGradient id="sbt-glow" cx="0.5" cy="0.36" r="0.5">
          <stop offset="0" stopColor="#f0b45c" stopOpacity="0.5" />
          <stop offset="1" stopColor="#f0b45c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sbt-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7d08a" />
          <stop offset="0.5" stopColor="#f0b45c" />
          <stop offset="1" stopColor="#b9822f" />
        </linearGradient>
        <linearGradient id="sbt-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1a14" />
          <stop offset="1" stopColor="#1a0f12" />
        </linearGradient>
        <linearGradient id="sbt-violet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>

      <rect width="400" height="150" fill="url(#sbt-bg)" />
      <rect width="400" height="150" fill="url(#sbt-glow)" />

      {/* sparkle diamonds */}
      <Diamond cx={70} cy={36} s={4} fill="#f0b45c" opacity={0.6} />
      <Diamond cx={336} cy={44} s={3} fill="#f7d08a" opacity={0.5} />
      <Diamond cx={92} cy={116} s={2.6} fill="#a78bfa" opacity={0.5} />
      <Diamond cx={320} cy={112} s={3.4} fill="#f0b45c" opacity={0.45} />

      {/* left sealed card (gold) */}
      <g transform="rotate(-9 150 86)">
        <rect x="116" y="44" width="68" height="92" rx="9" fill="url(#sbt-card)" stroke="#f0b45c" strokeOpacity="0.7" strokeWidth="1.6" />
        <rect x="123" y="51" width="54" height="78" rx="6" fill="none" stroke="#f0b45c" strokeOpacity="0.25" strokeWidth="1" />
        <Diamond cx={150} cy={90} s={15} fill="url(#sbt-gold)" />
        <Diamond cx={150} cy={90} s={7} fill="#241009" opacity={0.35} />
      </g>

      {/* right sealed card (violet) */}
      <g transform="rotate(9 250 86)">
        <rect x="216" y="44" width="68" height="92" rx="9" fill="url(#sbt-card)" stroke="#a78bfa" strokeOpacity="0.7" strokeWidth="1.6" />
        <rect x="223" y="51" width="54" height="78" rx="6" fill="none" stroke="#a78bfa" strokeOpacity="0.25" strokeWidth="1" />
        <Diamond cx={250} cy={90} s={15} fill="url(#sbt-violet)" />
        <Diamond cx={250} cy={90} s={7} fill="#1a1033" opacity={0.4} />
      </g>

      {/* central treasury gem, glowing above the duel */}
      <circle cx="200" cy="52" r="30" fill="url(#sbt-glow)" />
      <Diamond cx={200} cy={50} s={20} fill="url(#sbt-gold)" />
      <path d="M180 50 L200 30 L220 50 Z" fill="#fff" opacity="0.28" />
      <Diamond cx={200} cy={50} s={20} fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={1} />
    </svg>
  );
}

/** A diamond (rotated-square gem) centered at (cx,cy) with half-diagonal s. */
function Diamond({
  cx,
  cy,
  s,
  fill,
  opacity,
  stroke,
  strokeOpacity,
  strokeWidth,
}: {
  cx: number;
  cy: number;
  s: number;
  fill: string;
  opacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
}) {
  return (
    <path
      d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`}
      fill={fill}
      opacity={opacity}
      stroke={stroke}
      strokeOpacity={strokeOpacity}
      strokeWidth={strokeWidth}
    />
  );
}

/* ============================ FALLBACK ============================ */

function FallbackThumb({ gameId }: { gameId: string }) {
  const initials = gameId.slice(0, 2).toUpperCase();
  return (
    <svg {...svgProps} role="img" aria-label={`${gameId} cover art`}>
      <defs>
        <linearGradient id="fbt-bg" x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#170f2a" />
          <stop offset="1" stopColor="#0f1f2b" />
        </linearGradient>
        <radialGradient id="fbt-glow" cx="0.65" cy="1" r="0.7">
          <stop offset="0" stopColor="#a78bfa" stopOpacity="0.4" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="150" fill="url(#fbt-bg)" />
      <rect width="400" height="150" fill="url(#fbt-glow)" />
      <text
        x="200"
        y="100"
        textAnchor="middle"
        fontFamily="'Space Grotesk', sans-serif"
        fontWeight="700"
        fontSize="64"
        fill="#a78bfa"
        opacity="0.18"
      >
        {initials}
      </text>
    </svg>
  );
}
