export type ModuleCode = "M1" | "M2" | "M3" | "M4" | "M5" | "M6";

export interface MinTechModule {
  code: ModuleCode;
  name: string;
  solves: string;
  mainInterface: string;
  href: string;
  accent: string;
}

export const MINTECH_MODULES: MinTechModule[] = [
  {
    code: "M1",
    name: "Bag Inventory & Damage Evidence",
    solves: "Problem 1A - bag leakage, fraud, tax over-assessment",
    mainInterface: "Android camera-first PWA + Telegram fallback",
    href: "/bags",
    accent: "bg-red-600",
  },
  {
    code: "M2",
    name: "Purchase Request Trust Loop",
    solves: "Problem 1B - worker/owner distrust on purchases",
    mainInterface: "Telegram bot + owner dashboard",
    href: "/purchases",
    accent: "bg-amber-600",
  },
  {
    code: "M3",
    name: "Receivables & Withholding Tracker",
    solves: "Problem 2A - late payments, missing 3% WHT receipts",
    mainInterface: "Accountant web panel + SMS gateway",
    href: "/receivables",
    accent: "bg-sky-700",
  },
  {
    code: "M4",
    name: "Receipt Inbox & Monthly Sales Report",
    solves: "Problem 2B - who paid, who didn't, monthly financials",
    mainInterface: "Telegram bot (clients) + LLM receipt reading",
    href: "/receipts",
    accent: "bg-violet-700",
  },
  {
    code: "M5",
    name: "Owner's Daily Dashboard & Morning Brief",
    solves: "Problem 3 - daily production/sales visibility",
    mainInterface: "Mobile web app (PWA) on Vercel + Telegram push",
    href: "/",
    accent: "bg-emerald-700",
  },
  {
    code: "M6",
    name: "Truck & Raw-Material Traceability",
    solves: "Problem 4 - which truck brought the bad stone",
    mainInterface: "Gate check-in app + AI stone scoring",
    href: "/gate",
    accent: "bg-stone-700",
  },
];
