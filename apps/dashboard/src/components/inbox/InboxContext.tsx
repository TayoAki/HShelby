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

/** The best name the app gave us; anonymous users are told apart by the device ID's tail. */
export const deviceLabel = (device: Pick<InboxDevice, "id" | "name" | "email" | "userId">) =>
  device.name ?? device.email ?? (device.userId ? `User ${device.userId}` : `Anonymous · ${device.id.slice(-4).toUpperCase()}`);
