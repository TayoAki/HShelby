const palette = [
  "linear-gradient(150deg,#f7b267,#d9603b)",
  "linear-gradient(150deg,#7aa7d9,#3d5a80)",
  "linear-gradient(150deg,#9ad0a5,#3f7f5a)",
  "linear-gradient(150deg,#c3a6ef,#7a52c7)",
  "linear-gradient(#a9adb6,#868a93)",
];

function hash(value: string) {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Initial-letter avatar; the background is picked from the name unless given. */
export function Avatar({ name, className = "", background }: { name: string; className?: string; background?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none text-white ${className}`}
      style={{ background: background ?? palette[hash(name) % palette.length] }}
    >
      {name[0]}
    </span>
  );
}
