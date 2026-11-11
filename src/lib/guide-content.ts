/**
 * The 📖 Guide: what every part of the dashboard shows, how to read it, where
 * its figures come from, and a link to it.
 *
 * Content only (no React, no database), so updating the guide is editing this
 * list. Every `href` is checked against the real routes, tabs and anchors by a
 * test; when a screen moves, its entry here moves with it.
 */

export interface GuideItem {
  title: string;
  /** What it shows and how to read it. One idea per line. */
  body: string[];
  /** Where it comes from: which bot button or screen feeds it. */
  source?: string;
  href?: string;
}

export interface GuideSection {
  id: string;
  icon: string;
  title: string;
  intro: string;
  href?: string;
  items: GuideItem[];
}

export const GUIDE: GuideSection[] = [
  {
    id: "start",
    icon: "🚀",
    title: "Getting started",
    intro: "How the dashboard is organised, who can do what, and how to move around.",
    items: [
      {
        title: "Signing in and roles",
        body: [
          "Super Admin signs in with the password only (leave the name empty). It can do everything, including adding Chief Manager and HR accounts.",
          "Chief Manager signs in with a name and password. It can add bot employees and edit submissions, but cannot add dashboard accounts or delete.",
          "HR Manager is view only: everything can be seen, nothing can be changed.",
          "The top bar shows who is signed in and their role. If it looks wrong, log out and sign in again.",
        ],
        href: "/login",
      },
      {
        title: "The sections",
        body: [
          "☀️ Brief: the whole company at a glance.",
          "🏭 Production, 📦 Assets, 🤝 Sales and 💵 Finance: one page per department, built from what employees file through the Telegram bot.",
          "💬 AI: ask questions about the data in plain words.",
          "📖 Guide: this page. ⚙️ Settings: employees, submissions and system pages.",
        ],
      },
      {
        title: "Choosing a time window",
        body: [
          "Most charts have range buttons: Daily, Weekly, Monthly (last 30 days), 90 days, 6 months, Yearly.",
          "📅 Month shows one calendar month on its own, day by day (for example Oct 2026).",
          "Days are East Africa Time.",
        ],
      },
      {
        title: "Loading, errors and empty sections",
        body: [
          "A section that is still working says \"Loading …\". After 10 seconds it says \"Still working\"; please wait, some reports take up to a minute.",
          "If a section fails it says so in red with the reason and a Try again button. A failure is never shown as an empty list.",
          "On the Assets page, sections further down load as you scroll to them, so the page opens faster.",
        ],
      },
    ],
  },
  {
    id: "brief",
    icon: "☀️",
    title: "Brief",
    intro: "One card per department, for the chosen time window.",
    href: "/",
    items: [
      {
        title: "Production card",
        body: ["How many production reports and whiteness checks were filed in the window."],
        source: "🏭 Daily production report, ⚪ Whiteness check (bot).",
        href: "/",
      },
      {
        title: "Asset Management card",
        body: [
          "🧱 Raw material used: tonnes of stone used in the window. It is every ton produced, on its own material (Dolomite, Lime Stone or Talc), plus 5% for wastage.",
          "📥 Goods received, 📤 Store issues and 🛒 Purchase requests: how many were filed.",
        ],
        source: "Production reports, GRV, SIV and purchase requests.",
        href: "/",
      },
      {
        title: "Sales card",
        body: ["Number of sales and tonnes sold in the window."],
        source: "🧾 Sales report (bot).",
        href: "/",
      },
      {
        title: "Finance card",
        body: ["The credit book (what is owed), cash sales and the month's net worth, in millions of birr."],
        href: "/",
      },
    ],
  },
  {
    id: "production",
    icon: "🏭",
    title: "Production",
    intro: "What the plant made each day, how white it was, and the hours it lost.",
    href: "/departments/production",
    items: [
      {
        title: "Daily production table and charts",
        body: [
          "One row per day, one column per product (ETL-15, ETL-9 … Talc), in tons, with totals.",
          "A ⭐ Grade 1 row under a day shows Grade 1 production. It is kept out of the totals and the charts because it is priced apart.",
          "Charts show the same figures over the chosen window.",
        ],
        source: "🏭 የቀኑ የምርት ሪፖርት (Daily production report).",
        href: "/departments/production#production",
      },
      {
        title: "Production hours (downtime)",
        body: [
          "Filed once a month from a photo of the Production Hours sheet: per line, hours working and hours lost to power, mechanical, electrical and raw-material stops.",
          "The plant works 12 hours a day: a 31-day month has 372 working hours per line. \"Days (12 h)\" counts 12-hour days.",
          "The headline is hours lost as a share of the month's working hours.",
        ],
        source: "⏱ የወሩ የምርት መቋረጥ ሪፖርት (Monthly downtime).",
        href: "/departments/production#downtime",
      },
      {
        title: "Whiteness quality",
        body: [
          "Four checks a day, per product and line. Readings below the product's specification are flagged.",
          "Use the range buttons to see today, a week, a month or 90 days.",
        ],
        source: "⚪ የነጭነት ጥራት ምርመራ.",
        href: "/departments/production#whiteness",
      },
    ],
  },
  {
    id: "assets",
    icon: "📦",
    title: "Assets",
    intro: "Raw material, the store, PP bags and purchase requests.",
    href: "/departments/asset_management",
    items: [
      {
        title: "🧱 Raw material",
        body: [
          "Per month: Opening, Received, Used and Remaining for Dolomite, Lime Stone and Talc, plus a table for every day.",
          "Used is calculated, not reported: each day's production tons on their material, plus 5% wastage (ETL and EL products use Dolomite, EC products use Lime Stone, Talc uses Talc).",
          "Received comes from 🧱 የጥሬ ዕቃ ገቢ, filed when stone arrives. Raw material bought on credit (🚚) does not add stock; it records what is owed.",
          "Opening is the month's filed beginning balance; without one it carries the calculated closing of the month before. October 2026 opened with the last September count.",
          "A negative Remaining shows in red: stock was used that was never recorded as arriving.",
          "⭐ Grade 1 has its own stone, shown apart only when there is any.",
        ],
        href: "/departments/asset_management#raw-material",
      },
      {
        title: "Vouchers and the PP bag stock check",
        body: [
          "GRV (goods received) and SIV (store issues) as filed, with their lines.",
          "PP bag stock check, per bag kind and company: Opening + Received − Issued = Expected, compared with the count Production filed.",
          "Gap = Counted − Expected. A gap means bags moved without being reported: a delivery not filed through 🧺 PP bags received, or bags used not filed through 🧺 Daily PP bag usage.",
          "Before the first count of the month, Counted shows the running balance in grey and Gap says \"no count\".",
          "PP bags on a GRV or SIV do not move this balance; only the two 🧺 reports do.",
        ],
        href: "/departments/asset_management#vouchers",
      },
      {
        title: "Stock on hand",
        body: [
          "Production's closing count of finished product (tons) and empty bags (pieces), over the chosen window.",
        ],
        source: "The stock section of 🏭 Daily production report.",
        href: "/departments/asset_management#stock-on-hand",
      },
      {
        title: "PP bags used and damaged",
        body: [
          "🧺 PP bags used: what production reported using each day, per kind.",
          "💔 PP bag damage: damage reports with photos, to accept or reject.",
        ],
        href: "/departments/asset_management#pp-bag-usage",
      },
      {
        title: "🛒 Purchase requests",
        body: [
          "Grouped by department. Production requests for PP bags or sewing thread show under Production; machine parts asked for by production show under Technical.",
          "✓ Execute marks a request done. A request also shows ✓ Executed by itself once a GRV received an item with a similar name, with the GRV number and date.",
          "Tap a request for its photo, the AI check and how often the same item was asked for before.",
        ],
        source: "🛒 የግዢ ጥያቄ (bot).",
        href: "/departments/asset_management#purchase-requests",
      },
      {
        title: "🧰 Store inventory",
        body: [
          "Every store item by block (Mechanical, Electrical, Auxiliary materials) and group: last count, moved on by the GRVs and SIVs since, and its value at the latest unit cost.",
          "Search finds an item across all groups. Groups not counted in 7 days are marked.",
        ],
        source: "🧰 Store count, GRV and SIV.",
        href: "/departments/asset_management#store",
      },
      {
        title: "🛡 Bag control",
        body: ["Bag lots, damage claims to co-sign or verify, and Tripwires (damage by worker, shift and supplier lot, loaded when its tab is opened)."],
        href: "/departments/asset_management#bag-control",
      },
    ],
  },
  {
    id: "sales",
    icon: "🤝",
    title: "Sales",
    intro: "Every sale, and what it says about customers.",
    href: "/departments/sales",
    items: [
      {
        title: "📈 Customer analytics",
        body: ["Top customers, products and trends for the chosen window or month."],
        href: "/departments/sales#sales-analytics",
      },
      {
        title: "Sales table",
        body: [
          "One row per sale: date, customer, TIN, cash, credit, tons per product and bank.",
          "✅ next to a customer: approved by the Sales data manager. ✏️: corrected by them. Hover to see who.",
          "A TIN typed on one sale fills in on that customer's other sales, matching similar names.",
        ],
        source: "🧾 የሽያጭ ሪፖርት (filled from a copyable table, no photos), reviewed through 📋 Sales data manager.",
        href: "/departments/sales#sales-table",
      },
    ],
  },
  {
    id: "finance",
    icon: "💵",
    title: "Finance",
    intro: "Six tabs: RM credit, Monthly, Credit, WHT, Banks and Purchase status.",
    href: "/departments/finance",
    items: [
      {
        title: "🚚 RM credit",
        body: [
          "Raw material bought on credit, one row per truck: quarry owner, agent, plate, tonnes, amount, paid and owed.",
          "Tap a load to see or record its payments.",
        ],
        source: "🚚 Raw material credit purchase, 💸 Raw material credit payment.",
        href: "/departments/finance?tab=rmcredit",
      },
      {
        title: "📊 Monthly report",
        body: [
          "Products, raw materials and PP bags: base balance (opening), received, issued or sold, stock, unit price and net worth.",
          "If no beginning balance was filed, the opening is carried from the last figures submitted; the amber note says from where.",
          "If a month has no price list, the last prices filed are used.",
          "Store net worth: Mechanical, Electrical and Auxiliary materials at their unit costs. Items with stock but no price are counted and named \"not priced\".",
          "⭐ Grade 1 appears below, only when there is any, at Grade 1 prices.",
          "🏦 Total net worth adds products, raw material and PP bags, the store and Grade 1.",
          "Unit costs at the bottom can be corrected here for the month.",
        ],
        href: "/departments/finance?tab=monthly",
      },
      {
        title: "💳 Credit",
        body: [
          "By customer: one row per customer with how much they owe in total; tap to see their sales. By sale: one row per sale.",
          "What is owed is the Net Pay (after the 3% withholding).",
          "Each sale has a month to be collected; the countdown turns amber 7 days before and red when overdue. A customer past the tonnage limit raises an alarm.",
          "Tap a sale to record a payment. \"Show settled\" adds paid-off sales.",
        ],
        href: "/departments/finance?tab=credit",
      },
      {
        title: "📄 WHT",
        body: [
          "Customers who still owe the withholding (WHT) receipt.",
          "They get an SMS as soon as they are added, then one a week until the receipt is marked received.",
        ],
        source: "📄 WHT ደረሰኝ ያዢ (bot) or the dashboard.",
        href: "/departments/finance?tab=wht",
      },
      {
        title: "🏦 Banks",
        body: ["Cash collected per bank, read from the sales reports."],
        href: "/departments/finance?tab=banks",
      },
      {
        title: "🛍 Purchase status",
        body: [
          "What was bought, read straight from the GRVs: spend by supplier, over time, item price history and every received line.",
          "USD vouchers are converted with that month's dollar rate (or the last one filed).",
          "Purchase requests with their status, including ✓ Executed when a GRV received the item.",
        ],
        href: "/departments/finance?tab=purchases",
      },
    ],
  },
  {
    id: "ai",
    icon: "💬",
    title: "AI assistant",
    intro: "Ask about the company's data in plain words.",
    href: "/chat",
    items: [
      {
        title: "Asking",
        body: [
          "Ask things like \"How were sales this week?\", \"Who owes us the most?\" or \"Compare October's production with September\".",
          "It reads the live data before answering and draws a chart for comparisons and trends, with the figures in a table under it.",
          "There is a daily limit of questions per device; the counter shows what is left. A failed answer does not use one up.",
        ],
        href: "/chat",
      },
    ],
  },
  {
    id: "settings",
    icon: "⚙️",
    title: "Settings",
    intro: "Employees, submissions and the system pages.",
    href: "/settings",
    items: [
      {
        title: "Employees",
        body: [
          "Add a Telegram user with a full name and password, then tick their bot functionalities. What is ticked is exactly their bot menu. Names are shown in English here.",
          "HR receives the daily departmental report; ADMIN receives everything including system status. With nothing else ticked they only receive reports.",
          "Reset password, force sign-out, unlock, deactivate or archive an employee.",
        ],
        href: "/settings?tab=users",
      },
      {
        title: "Submissions",
        body: [
          "Every report ever filed, by type and date, searchable. Open one to see all its fields.",
          "Chief Manager and Super Admin can edit; only Super Admin can delete. A deleted report goes to the recycle bin and can be restored.",
          "Sales reports show the Sales data manager's review here too.",
        ],
        href: "/settings?tab=submissions",
      },
      {
        title: "Bot activity",
        body: ["Every bot action: sign-ins, menu taps, submissions and refusals."],
        href: "/settings?tab=activity",
      },
      {
        title: "Errors, Devices and Web users (Super Admin)",
        body: [
          "Errors: what went wrong and when, and tests for each connected service.",
          "Devices: every browser signed in, to sign one out.",
          "Web users: create Chief Manager and HR accounts.",
        ],
        href: "/settings?tab=errors",
      },
    ],
  },
  {
    id: "bot",
    icon: "🤖",
    title: "The Telegram bot",
    intro: "Where the data on every page comes from. Each employee sees only the buttons ticked for them in Settings.",
    items: [
      { title: "🏭 Daily production report", body: ["Production, stock, delivered and bag counts for the day; optional ⭐ Grade 1."], href: "/departments/production#production" },
      { title: "🧺 Daily PP bag usage · 🧺 PP bags received · 💔 PP bag damage", body: ["Bags used, delivered and damaged; they drive the PP bag stock check."], href: "/departments/asset_management#vouchers" },
      { title: "🧱 Raw material received", body: ["Stone that arrived, with optional ⭐ Grade 1."], href: "/departments/asset_management#raw-material" },
      { title: "⚪ Whiteness · ⏱ Monthly downtime", body: ["Quality checks and the monthly hours sheet."], href: "/departments/production#whiteness" },
      { title: "📥 GRV · 📤 SIV · 📎 Stationery issue · 🧰 Store count", body: ["What comes into and leaves the store, and the counts."], href: "/departments/asset_management#store" },
      { title: "🛒 Purchase request", body: ["A damaged item (photo checked by AI) or a new tool."], href: "/departments/asset_management#purchase-requests" },
      { title: "🧾 Sales report · 📋 Sales data manager · 💳 Credit payment", body: ["Each sale from a copyable table; yesterday's sales each morning to approve or edit; money collected on credit."], href: "/departments/sales#sales-table" },
      { title: "📊 Monthly beginning balance · 💲 Monthly unit price · 🧺 PP bag price", body: ["Openings and prices for the monthly report."], href: "/departments/finance?tab=monthly" },
      { title: "🚚 RM credit purchase · 💸 RM credit payment · 📄 WHT holder", body: ["Raw material owed and paid; customers owing a WHT receipt."], href: "/departments/finance?tab=rmcredit" },
    ],
  },
  {
    id: "glossary",
    icon: "📚",
    title: "Glossary",
    intro: "The words used across the dashboard.",
    items: [
      { title: "Opening / Base balance", body: ["What a month starts with: filed through 📊 Monthly beginning balance, or carried from the last figures submitted."] },
      { title: "Carried", body: ["A figure taken from the last submission because nothing was filed for the month."] },
      { title: "Expected · Counted · Gap", body: ["Expected = opening + received − issued. Counted = the physical count. Gap = counted − expected."] },
      { title: "Wastage 5%", body: ["Raw material used = tons produced × 1.05."] },
      { title: "GRV · SIV · FGR · CRV · M.R.V", body: ["Goods Receiving Voucher · Store Issue Voucher · Finished Goods Receiving voucher · Cash Receipt Voucher · Material Receiving Voucher."] },
      { title: "Net Pay · WHT", body: ["Net Pay = grand total after VAT minus the 3% withholding (WHT). The customer owes a WHT receipt for what was withheld."] },
      { title: "Grade 1", body: ["Production and stone kept and priced apart from the normal grade."] },
      { title: "Technical", body: ["Purchase requests from production for machine parts, shown apart from production's PP bags and thread."] },
    ],
  },
];

/** Every link the guide offers, for the test that checks they exist. */
export function guideLinks(): string[] {
  const out: string[] = [];
  for (const s of GUIDE) {
    if (s.href) out.push(s.href);
    for (const it of s.items) if (it.href) out.push(it.href);
  }
  return out;
}
