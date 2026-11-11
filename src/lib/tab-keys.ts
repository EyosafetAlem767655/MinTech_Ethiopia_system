/**
 * The tabs a link can open with `?tab=` — Finance's and Settings' — kept here
 * so the Guide's links can be checked against them without loading the pages.
 */
export const FINANCE_TABS = ["rmcredit", "monthly", "credit", "wht", "banks", "purchases"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];

export const SETTINGS_TABS = ["users", "submissions", "errors", "activity", "devices", "webusers"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
