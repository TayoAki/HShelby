import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center text-[#242424]">
      <p className="inline-flex items-baseline gap-[.16em] text-2xl leading-none tracking-[-.05em]">
        <span className="inline-block size-[1ex] rounded-full bg-[#f60]" />
        reception clone
      </p>
      <p className="max-w-md text-[15px] leading-relaxed text-[#909090]">
        This study clone only rebuilds the landing page. Login, docs, the inbox and legal pages live on the original
        product.
      </p>
      <Link href="/" className="rounded-full bg-[#ff4b2b] px-6 py-3 text-sm text-white hover:bg-[#e93e20]">
        Back to the landing page
      </Link>
    </main>
  );
}
