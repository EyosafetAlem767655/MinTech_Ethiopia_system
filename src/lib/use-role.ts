"use client";

import { useEffect, useState } from "react";
import type { Role } from "@/lib/roles";

/**
 * Who is signed in, for the panels: the role decides which buttons are drawn.
 * The server refuses the same actions anyway (src/middleware.ts) — hiding them
 * only spares a view-only user buttons that would answer "not allowed".
 *
 * One request per page load, shared by every panel that asks.
 */

export interface Me {
  role: Role;
  roleLabel: string;
  name: string;
}

let pending: Promise<Me | null> | null = null;

function loadMe(): Promise<Me | null> {
  pending ??= fetch("/api/me", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
    .catch(() => null)
    .then((me) => {
      // A failed answer is not remembered: the next panel asks again rather
      // than every panel drawing for an unknown role until a reload.
      if (!me) pending = null;
      return me;
    });
  return pending;
}

/** Null while loading. Until it is known, panels draw as they always have. */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let alive = true;
    loadMe().then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);
  return me;
}

/** True unless the signed-in account is view-only (HR Manager). */
export function useCanEdit(): boolean {
  return useMe()?.role !== "hr";
}

/** True only for the Super Admin — deleting, purging, system pages, web users. */
export function useIsSuper(): boolean {
  return useMe()?.role === "super";
}
