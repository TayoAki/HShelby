/* SVG stand-ins for the three cut-out photos behind the hero phone
   (crumpled-hundred, orange-scooter, chrome-stars; all 1536×1024 in the original). */

function Banknote({ x, y, rotate }: { x: number; y: number; rotate: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate} 240 290)`} filter="url(#note-shadow)">
      <rect width="480" height="580" rx="14" fill="url(#note-paper)" />
      <rect x="22" y="22" width="436" height="536" rx="8" fill="none" stroke="#5f7356" strokeWidth="5" strokeDasharray="2 7" />
      <rect x="40" y="40" width="400" height="500" rx="6" fill="none" stroke="#6b7c61" strokeWidth="2" />
      <ellipse cx="240" cy="290" rx="112" ry="142" fill="url(#note-portrait)" stroke="#5c6b52" strokeWidth="3" />
      <text x="62" y="112" fontFamily="Georgia,serif" fontSize="74" fontWeight="700" fill="#3e5a46">100</text>
      <text x="418" y="520" textAnchor="end" fontFamily="Georgia,serif" fontSize="74" fontWeight="700" fill="#3e5a46">100</text>
      <text x="240" y="132" textAnchor="middle" fontFamily="Georgia,serif" fontSize="22" letterSpacing="3" fill="#4f5f48">FEDERAL RESERVE NOTE</text>
      <text x="240" y="478" textAnchor="middle" fontFamily="Georgia,serif" fontSize="26" letterSpacing="4" fill="#4f5f48">ONE HUNDRED</text>
      <text x="96" y="200" fontFamily="Georgia,serif" fontSize="34" fill="#2f7a5b">KK 2204</text>
      {/* crumple folds */}
      <path d="M0 160 L480 230 L480 260 L0 196Z" fill="#000" opacity=".08" />
      <path d="M0 330 L480 300 L480 318 L0 352Z" fill="#fff" opacity=".18" />
      <path d="M150 0 L210 580 L236 580 L178 0Z" fill="#000" opacity=".07" />
      <path d="M330 0 L300 580 L318 580 L350 0Z" fill="#fff" opacity=".16" />
      <path d="M0 450 L480 420 L480 436 L0 470Z" fill="#000" opacity=".06" />
    </g>
  );
}

export function BanknotesArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1536 1024" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="note-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ece6cd" />
          <stop offset=".5" stopColor="#d8d0ad" />
          <stop offset="1" stopColor="#c6be98" />
        </linearGradient>
        <radialGradient id="note-portrait" cx=".5" cy=".42" r=".6">
          <stop offset="0" stopColor="#e3dcc0" />
          <stop offset="1" stopColor="#a9a283" />
        </radialGradient>
        <filter id="note-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="16" floodOpacity=".22" />
        </filter>
      </defs>
      <Banknote x={150} y={230} rotate={-9} />
      <Banknote x={906} y={214} rotate={7} />
    </svg>
  );
}

export function ScooterArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1536 1024" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="scooter-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8a3d" />
          <stop offset=".55" stopColor="#f2581b" />
          <stop offset="1" stopColor="#c43d0c" />
        </linearGradient>
        <radialGradient id="scooter-hub" cx=".4" cy=".35" r=".7">
          <stop offset="0" stopColor="#f4f4f6" />
          <stop offset="1" stopColor="#8e8e93" />
        </radialGradient>
        <filter id="scooter-shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="20" stdDeviation="14" floodOpacity=".25" />
        </filter>
      </defs>
      <g filter="url(#scooter-shadow)">
        <ellipse cx="768" cy="830" rx="430" ry="26" fill="#000" opacity=".12" />
        <path d="M430 690 C430 560 520 470 640 470 L900 470 C1000 470 1060 520 1080 600 L1110 700 L520 720 C470 720 430 712 430 690Z" fill="url(#scooter-body)" />
        <path d="M1040 300 L1150 300 L1190 690 L1120 700 L1080 420Z" fill="url(#scooter-body)" />
        <rect x="560" y="420" width="300" height="60" rx="30" fill="#2b2420" />
        <path d="M1050 300 L1000 220 M1120 240 L1200 220" stroke="#3a3a3c" strokeWidth="18" strokeLinecap="round" />
        <circle cx="1150" cy="270" r="34" fill="#f5f5f7" stroke="#9e9ea3" strokeWidth="8" />
        <circle cx="560" cy="760" r="108" fill="#1c1c1e" />
        <circle cx="560" cy="760" r="56" fill="url(#scooter-hub)" />
        <circle cx="1140" cy="760" r="108" fill="#1c1c1e" />
        <circle cx="1140" cy="760" r="56" fill="url(#scooter-hub)" />
        <path d="M470 560 C520 520 600 512 660 520" stroke="#fff" strokeOpacity=".35" strokeWidth="14" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

function ChromeStar({ cx, cy, r, rotate }: { cx: number; cy: number; r: number; rotate: number }) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.45;
    return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");
  return (
    <g transform={`rotate(${rotate} ${cx} ${cy})`} filter="url(#star-shadow)">
      <polygon points={points} fill="url(#chrome)" stroke="#6e7177" strokeWidth="3" strokeLinejoin="round" />
      <polygon points={points} fill="url(#chrome-sheen)" />
    </g>
  );
}

export function ChromeStarsArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1536 1024" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbfbfc" />
          <stop offset=".3" stopColor="#9ea2a8" />
          <stop offset=".5" stopColor="#eef0f2" />
          <stop offset=".72" stopColor="#5f6368" />
          <stop offset="1" stopColor="#d9dce0" />
        </linearGradient>
        <linearGradient id="chrome-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id="star-shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="22" stdDeviation="18" floodOpacity=".22" />
        </filter>
      </defs>
      <ChromeStar cx={330} cy={430} r={190} rotate={-14} />
      <ChromeStar cx={250} cy={760} r={120} rotate={10} />
      <ChromeStar cx={1220} cy={400} r={170} rotate={12} />
      <ChromeStar cx={1300} cy={720} r={130} rotate={-8} />
    </svg>
  );
}
