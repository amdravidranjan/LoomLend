"use client";

import { usePathname } from "next/navigation";
import { GridSkeleton, ListSkeleton, PageSkeleton } from "./skeletons";

/** Picks the skeleton that matches the page being loaded, so nested detail pages get a detail-shaped placeholder. */
export function RouteSkeleton() {
  const p = usePathname();
  if (p === "/resources") return <GridSkeleton label="Loading resources" />;
  if (p === "/bookings") return <ListSkeleton label="Loading your bookings" />;
  if (p === "/notifications") return <div className="mx-auto max-w-3xl"><ListSkeleton rows={6} label="Loading notifications" /></div>;
  return <PageSkeleton />;
}
