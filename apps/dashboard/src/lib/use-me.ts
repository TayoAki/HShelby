import type { Me } from "@hshelby/contracts";
import { useEffect, useState } from "react";
import { api } from "./api";

// One request per page load; signing out reloads the page, which drops it.
let pending: Promise<Me> | null = null;

/** The signed-in user and their role in the active workspace. */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    (pending ??= api<Me>("/me")).then(setMe).catch(() => {
      pending = null;
    });
  }, []);
  return me;
}

export const isAdmin = (me: Me | null) => me?.organization?.role === "owner" || me?.organization?.role === "admin";
