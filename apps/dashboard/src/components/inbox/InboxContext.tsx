"use client";

import type { InboxConversation, InboxDevice } from "@hshelby/contracts";
import { createContext, use } from "react";

export type InboxState = {
  conversations: InboxConversation[] | null;
  /** Re-fetches the list after the thread changes something (reply, read, resolve, block). */
  refresh: () => void;
};

export const InboxContext = createContext<InboxState>({ conversations: null, refresh: () => {} });

export const useInbox = () => use(InboxContext);

/** Until identify() lands (phase B4), users are anonymous; the device ID's tail tells them apart. */
export const deviceLabel = (device: Pick<InboxDevice, "id">) => `Anonymous · ${device.id.slice(-4).toUpperCase()}`;
