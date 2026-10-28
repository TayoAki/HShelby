"use client";

import type { Attachment } from "@hshelby/contracts";
import { Cross2Icon } from "@radix-ui/react-icons";
import { useEffect } from "react";

/* Photo links are signed and expire after 15 minutes, so they skip next/image's optimizer and cache. */

/** A message's photos, sized from their stored dimensions so the thread doesn't jump while they load. */
export function MessagePhotos({ attachments, align, onOpen }: { attachments: Attachment[]; align: "start" | "end"; onOpen: (a: Attachment) => void }) {
  return (
    <div className={`flex max-w-[75%] flex-wrap gap-1.5 ${align === "end" ? "justify-end" : ""}`}>
      {attachments.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpen(a)}
          aria-label="Open photo"
          className="overflow-hidden rounded-[18px] bg-panel outline outline-1 -outline-offset-1 outline-black/5"
          style={{ width: Math.min(240, (a.width / a.height) * 240), aspectRatio: `${a.width} / ${a.height}`, maxHeight: 320 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL */}
          <img src={a.url} alt="" width={a.width} height={a.height} className="size-full object-cover" />
        </button>
      ))}
    </div>
  );
}

export function PhotoViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-label="Photo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL */}
      <img src={attachment.url} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
      <button type="button" aria-label="Close" onClick={onClose} className="absolute top-4 right-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25">
        <Cross2Icon width={18} height={18} />
      </button>
    </div>
  );
}

/** A photo picked for the next reply: uploading, ready (stored on the server), or failed. */
export type StagedPhoto = { localId: string; previewUrl: string; attachment?: Attachment; error?: string };

export function StagedPhotos({ photos, onRemove }: { photos: StagedPhoto[]; onRemove: (localId: string) => void }) {
  if (photos.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pt-1 pb-2">
      {photos.map((p) => (
        <div key={p.localId} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <img
            src={p.previewUrl}
            alt=""
            className={`size-16 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-black/10 ${p.attachment ? "" : "opacity-50"} ${p.error ? "ring-2 ring-[#b42318]" : ""}`}
          />
          {!p.attachment && !p.error && <span className="absolute inset-x-0 bottom-1 text-center text-[10px] text-fg">Uploading…</span>}
          <button
            type="button"
            onClick={() => onRemove(p.localId)}
            aria-label="Remove photo"
            title={p.error}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-fg text-white"
          >
            <Cross2Icon width={10} height={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
