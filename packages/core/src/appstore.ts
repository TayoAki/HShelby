import type { AppStoreResult } from "@hshelby/contracts";

/** Extracts an App Store ID from a link (`…/id570060128…`) or a bare number. */
export function parseAppStoreId(input: string): string | null {
  const value = input.trim();
  if (/^\d{5,12}$/.test(value)) return value;
  const match = /(?:apps|itunes)\.apple\.com\/.*\bid(\d{5,12})\b/i.exec(value);
  return match ? match[1]! : null;
}

type ITunesResult = {
  trackId: number;
  trackName: string;
  bundleId?: string;
  sellerName?: string;
  trackViewUrl?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  kind?: string;
};

function toResult(r: ITunesResult): AppStoreResult {
  return {
    appStoreId: String(r.trackId),
    name: r.trackName,
    iconUrl: r.artworkUrl512 ?? r.artworkUrl100 ?? null,
    bundleId: r.bundleId ?? null,
    sellerName: r.sellerName ?? null,
    url: r.trackViewUrl ? r.trackViewUrl.replace(/\?uo=\d+$/, "") : null,
    genre: r.primaryGenreName ?? null,
  };
}

export type AppStoreClient = {
  search(query: string): Promise<AppStoreResult[]>;
  lookup(appStoreId: string): Promise<AppStoreResult | null>;
};

/** Apple's public iTunes Search API (no key). A link or ID in `search` does a lookup instead. */
export function createAppStoreClient({
  country = "us",
  fetch: fetchImpl = fetch,
  ttlMs = 10 * 60_000,
}: { country?: string; fetch?: typeof fetch; ttlMs?: number } = {}): AppStoreClient {
  const cache = new Map<string, { at: number; value: AppStoreResult[] }>();

  async function call(url: string): Promise<AppStoreResult[]> {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`App Store responded ${res.status}`);
    const body = (await res.json()) as { results?: ITunesResult[] };
    const value = (body.results ?? []).filter((r) => r.trackId && r.trackName).map(toResult);
    cache.set(url, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return value;
  }

  const lookup = async (id: string) =>
    (await call(`https://itunes.apple.com/lookup?id=${id}&country=${country}&entity=software`))[0] ?? null;

  return {
    lookup,
    async search(query) {
      const id = parseAppStoreId(query);
      if (id) {
        const app = await lookup(id);
        return app ? [app] : [];
      }
      const term = encodeURIComponent(query.trim().slice(0, 100));
      return call(`https://itunes.apple.com/search?term=${term}&entity=software&country=${country}&limit=8`);
    },
  };
}
