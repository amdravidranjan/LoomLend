import type { IconName } from "./icons";

export type NavRole = "member" | "owner" | "manager" | "admin" | null;
export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Second key of the "g …" chord. */
  key?: string;
  /** Where it sits: the primary bar, or behind "More". */
  place: "primary" | "more" | "account";
  description?: string;
};

const staff = (r: NavRole) => r === "owner" || r === "manager" || r === "admin";
const lead = (r: NavRole) => r === "manager" || r === "admin";

/** Every destination, filtered for the person's role. One list drives the header, tab bar, palette and shortcuts. */
export function navItems(role: NavRole): NavItem[] {
  const signedIn = role !== null;
  const all: (NavItem & { show: boolean })[] = [
    { href: "/", label: "Home", icon: "home", key: "h", place: "account", description: "Your dashboard", show: true },
    { href: "/resources", label: "Discover", icon: "compass", key: "d", place: "primary", description: "Find labs, equipment and spaces", show: true },
    { href: "/bookings", label: "My bookings", icon: "calendar", key: "b", place: "primary", description: "Upcoming, in use and past loans", show: signedIn },
    { href: "/scan", label: "Scan", icon: "scan", key: "s", place: "primary", description: "Check in or return with the item's QR tag", show: signedIn },
    { href: "/assistant", label: "Ask", icon: "sparkle", key: "a", place: "primary", description: "Booking concierge: describe what you need", show: signedIn },
    { href: "/manage", label: "Manage", icon: "layers", key: "m", place: "primary", description: "Requests, hand-overs and returns for your listings", show: staff(role) },
    { href: "/admin", label: role === "admin" ? "Admin desk" : "Verify & review", icon: "shield", key: "v", place: "more", description: "Verify IDs and training, audit log", show: lead(role) },
    { href: "/impact", label: "Impact", icon: "chart", key: "i", place: "more", description: "Hours shared and value unlocked", show: lead(role) },
    { href: "/fairness", label: "Fairness", icon: "scale", key: "f", place: "more", description: "Fairness ledger and open draws", show: true },
    { href: "/policy", label: "Fair-use policy", icon: "book", key: "u", place: "more", description: "Caps, priority formula and rules", show: true },
    { href: "/notifications", label: "Notifications", icon: "bell", key: "n", place: "account", description: "Your inbox", show: signedIn },
    { href: "/profile", label: "Profile", icon: "user", key: "p", place: "account", description: "Training, standing and activity", show: signedIn },
    { href: "/design", label: "Design system", icon: "palette", place: "more", description: "LoomLend's tokens and components", show: true },
  ];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return all.filter((i) => i.show).map(({ show, ...i }) => i);
}

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
