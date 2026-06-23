import mongoose, { Schema, model, models, type Model } from "mongoose";

/* ────────────────────────────── Shared helpers ───────────────────────────── */

const opts = { timestamps: true };

// Note: the cast (instead of `model<T>(...)`) avoids a TypeScript
// type-inference blowup in mongoose's generic `model` overloads.
function getModel<T>(name: string, schema: Schema<any>): Model<T> {
  return (models[name] || model(name, schema)) as Model<T>;
}

/* ─────────────────────────────── File storage ────────────────────────────── */
// Photos & documents are stored directly in MongoDB (fits the Atlas free tier;
// claim photos are compressed client-side before upload).

export interface IStoredFile {
  _id: mongoose.Types.ObjectId;
  data: Buffer;
  contentType: string;
  filename?: string;
  kind?: string; // claim_photo | lot_photo | receipt | purchase_request | disposal | other
  phash?: string;
  exif?: Record<string, unknown>;
  createdAt: Date;
}

const StoredFileSchema = new Schema<any>(
  {
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    filename: String,
    kind: String,
    phash: { type: String, index: true },
    exif: Schema.Types.Mixed,
  },
  opts
);

/* ──────────────────────── Module 1: PB Bag Control ───────────────────────── */

export interface IBagLot {
  _id: mongoose.Types.ObjectId;
  lotCode: string;
  supplier: string;
  bagType: string; // e.g. "PP woven 50kg"
  quantity: number;
  deliveryNote: string;
  photoIds: mongoose.Types.ObjectId[];
  registeredBy: string;
  handlers: string[]; // everyone who touched the lot
  receivedAt: Date;
  // Recomputed by the daily reconciliation job:
  balance?: {
    received: number;
    filled: number;
    damagedVerified: number;
    damagedPending: number;
    disposed: number;
    inStock: number;
    gap: number; // received - filled - damagedVerified - inStock → red flag if ≠ 0
    computedAt: Date;
  };
}

const BagLotSchema = new Schema<any>(
  {
    lotCode: { type: String, required: true, unique: true },
    supplier: { type: String, required: true },
    bagType: { type: String, required: true },
    quantity: { type: Number, required: true },
    deliveryNote: { type: String, required: true },
    photoIds: [{ type: Schema.Types.ObjectId, ref: "StoredFile" }],
    registeredBy: String,
    handlers: [String],
    receivedAt: { type: Date, default: Date.now },
    balance: {
      received: Number,
      filled: Number,
      damagedVerified: Number,
      damagedPending: Number,
      disposed: Number,
      inStock: Number,
      gap: Number,
      computedAt: Date,
    },
  },
  opts
);

// Movements against a lot (fills, manual stock counts, adjustments).
export interface IBagEvent {
  lotId: mongoose.Types.ObjectId;
  type: "filled" | "stock_count" | "adjustment";
  quantity: number;
  by: string;
  shift?: string;
  note?: string;
  date: Date;
}

const BagEventSchema = new Schema<any>(
  {
    lotId: { type: Schema.Types.ObjectId, ref: "BagLot", required: true, index: true },
    type: { type: String, enum: ["filled", "stock_count", "adjustment"], required: true },
    quantity: { type: Number, required: true },
    by: String,
    shift: String,
    note: String,
    date: { type: Date, default: Date.now },
  },
  opts
);

export interface IClaimPhoto {
  fileId: mongoose.Types.ObjectId;
  phash?: string;
  duplicateOfClaimId?: mongoose.Types.ObjectId;
  ai?: {
    bag_visible: boolean;
    matches_bag_type: boolean;
    damage_visible: boolean;
    damage_severity: "none" | "minor" | "moderate" | "severe";
    suspicious: boolean;
    suspicion_reasons: string[]; // screenshot | photo_of_screen | heavy_blur | ...
    notes?: string;
  };
  exifCheck?: {
    hasExif: boolean;
    issues: string[];
  };
}

export interface IDamageClaim {
  _id: mongoose.Types.ObjectId;
  lotId: mongoose.Types.ObjectId;
  quantity: number;
  source: "app" | "telegram";
  worker: string;
  shift?: string;
  gps?: { lat: number; lng: number };
  deviceId?: string;
  capturedAt?: Date;
  photos: IClaimPhoto[];
  flags: string[]; // duplicate_photo | suspicious_image | telegram_needs_cosign | exif_issue
  status: "pending" | "cosign_required" | "verified" | "rejected";
  cosignedBy?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  disposal?: {
    action: "returned_to_supplier" | "destroyed" | "sold_as_scrap";
    amount?: number; // ETB, when sold as scrap
    photoFileId?: mongoose.Types.ObjectId;
    recordedBy?: string;
    recordedAt?: Date;
  };
  createdAt: Date;
}

const DamageClaimSchema = new Schema<any>(
  {
    lotId: { type: Schema.Types.ObjectId, ref: "BagLot", required: true, index: true },
    quantity: { type: Number, required: true },
    source: { type: String, enum: ["app", "telegram"], required: true },
    worker: { type: String, required: true },
    shift: String,
    gps: { lat: Number, lng: Number },
    deviceId: String,
    capturedAt: Date,
    photos: [
      {
        fileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
        phash: String,
        duplicateOfClaimId: { type: Schema.Types.ObjectId, ref: "DamageClaim" },
        ai: {
          bag_visible: Boolean,
          matches_bag_type: Boolean,
          damage_visible: Boolean,
          damage_severity: String,
          suspicious: Boolean,
          suspicion_reasons: [String],
          notes: String,
        },
        exifCheck: { hasExif: Boolean, issues: [String] },
      },
    ],
    flags: [String],
    status: {
      type: String,
      enum: ["pending", "cosign_required", "verified", "rejected"],
      default: "pending",
      index: true,
    },
    cosignedBy: String,
    reviewedBy: String,
    reviewedAt: Date,
    disposal: {
      action: { type: String, enum: ["returned_to_supplier", "destroyed", "sold_as_scrap"] },
      amount: Number,
      photoFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
      recordedBy: String,
      recordedAt: Date,
    },
  },
  opts
);

/* ───────────────────── Operations data (Modules 3/4/6) ───────────────────── */

export interface IStoneDelivery {
  _id: mongoose.Types.ObjectId;
  truckPlate: string;
  supplier?: string;
  quarry?: string;
  driverName?: string;
  gateClerk?: string;
  loads: number;
  qualityGrade: "good" | "fair" | "dark/weathered";
  photoFileId?: mongoose.Types.ObjectId;
  aiScore?: {
    visible_stone: boolean;
    qualityGrade: "good" | "fair" | "dark/weathered";
    confidence: number;
    reasons: string[];
    recommendation?: string;
  };
  notes?: string;
  date: Date;
}

const StoneDeliverySchema = new Schema<any>(
  {
    truckPlate: { type: String, required: true },
    supplier: String,
    quarry: String,
    driverName: String,
    gateClerk: String,
    loads: { type: Number, default: 1 },
    qualityGrade: { type: String, enum: ["good", "fair", "dark/weathered"], default: "good" },
    photoFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    aiScore: {
      visible_stone: Boolean,
      qualityGrade: { type: String, enum: ["good", "fair", "dark/weathered"] },
      confidence: Number,
      reasons: [String],
      recommendation: String,
    },
    notes: String,
    date: { type: Date, default: Date.now, index: true },
  },
  opts
);

export interface IShiftReport {
  date: Date;
  shift: "day" | "night";
  supervisor: string;
  filledSacks: number;
  downtimeMinutes: number;
  notes?: string;
  lotId?: mongoose.Types.ObjectId;
}

const ShiftReportSchema = new Schema<any>(
  {
    date: { type: Date, default: Date.now, index: true },
    shift: { type: String, enum: ["day", "night"], default: "day" },
    supervisor: { type: String, required: true },
    filledSacks: { type: Number, required: true },
    downtimeMinutes: { type: Number, default: 0 },
    notes: String,
    lotId: { type: Schema.Types.ObjectId, ref: "BagLot" },
  },
  opts
);

export interface IInvoice {
  _id: mongoose.Types.ObjectId;
  invoiceNumber: string;
  client: string;
  clientPhone?: string;
  sacks: number;
  amount: number; // ETB
  invoicedAt: Date;
  dueDate: Date;
  payments: { amount: number; date: Date; method?: string }[];
  withholdingReceiptReceived: boolean;
  withholdingReceiptFileId?: mongoose.Types.ObjectId;
  withholdingReceiptReceivedAt?: Date;
  reminders?: { channel: "sms"; to: string; sentAt: Date; status: string }[];
  notes?: string;
}

const InvoiceSchema = new Schema<any>(
  {
    invoiceNumber: { type: String, required: true },
    client: { type: String, required: true, index: true },
    clientPhone: String,
    sacks: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    invoicedAt: { type: Date, default: Date.now, index: true },
    dueDate: { type: Date, required: true },
    payments: [{ amount: Number, date: Date, method: String }],
    withholdingReceiptReceived: { type: Boolean, default: false },
    withholdingReceiptFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    withholdingReceiptReceivedAt: Date,
    reminders: [{ channel: String, to: String, sentAt: Date, status: String }],
    notes: String,
  },
  opts
);

export interface IPurchaseRequest {
  _id: mongoose.Types.ObjectId;
  title: string;
  amount: number;
  requestedBy: string;
  justification?: string;
  photoFileId?: mongoose.Types.ObjectId;
  source: "app" | "telegram";
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: Date;
  createdAt: Date;
}

const PurchaseRequestSchema = new Schema<any>(
  {
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    requestedBy: { type: String, required: true },
    justification: String,
    photoFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    source: { type: String, enum: ["app", "telegram"], default: "app" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    decidedBy: String,
    decidedAt: Date,
  },
  opts
);

export interface IReceipt {
  vendor: string;
  client?: string;
  amount: number;
  category?: string;
  receiptDate?: Date;
  taxInvoiceNumber?: string;
  photoFileId?: mongoose.Types.ObjectId;
  submittedBy: string;
  source: "app" | "telegram";
  meta?: Record<string, unknown>;
}

const ReceiptSchema = new Schema<any>(
  {
    vendor: { type: String, required: true },
    client: String,
    amount: { type: Number, required: true },
    category: String,
    receiptDate: Date,
    taxInvoiceNumber: String,
    photoFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    submittedBy: String,
    source: { type: String, enum: ["app", "telegram"], default: "telegram" },
    meta: Schema.Types.Mixed,
  },
  opts
);

/* ─────────────────────────── Brief / infrastructure ──────────────────────── */

export interface IPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label?: string;
}

const PushSubscriptionSchema = new Schema<any>(
  {
    endpoint: { type: String, required: true, unique: true },
    keys: { p256dh: String, auth: String },
    label: String,
  },
  opts
);

export interface IBrief {
  date: string; // YYYY-MM-DD (the day the brief covers, i.e. yesterday)
  fiveLines: string[];
  exceptions: string[];
  narrative: string;
  numbers: Record<string, number>;
  sentTelegram: boolean;
  sentPush: boolean;
  createdAt: Date;
}

const BriefSchema = new Schema<any>(
  {
    date: { type: String, required: true, unique: true },
    fiveLines: [String],
    exceptions: [String],
    narrative: String,
    numbers: Schema.Types.Mixed,
    sentTelegram: Boolean,
    sentPush: Boolean,
  },
  opts
);

// Per-chat conversation state for the Telegram ingestion bot.
export interface ITelegramSession {
  chatId: string;
  userName?: string;
  state: "idle" | "awaiting_metadata";
  draft?: {
    docType?: string; // receipt | purchase_request | damage_claim | stone_delivery | other
    fileId?: string;
    extracted?: Record<string, unknown>;
    missing?: string[];
  };
  history: { role: "user" | "assistant"; content: string }[];
  updatedAt: Date;
}

const TelegramSessionSchema = new Schema<any>(
  {
    chatId: { type: String, required: true, unique: true },
    userName: String,
    state: { type: String, default: "idle" },
    draft: Schema.Types.Mixed,
    history: [{ role: String, content: String }],
  },
  opts
);

/* ───────────────────────────────── Exports ───────────────────────────────── */

export const StoredFile = getModel<IStoredFile>("StoredFile", StoredFileSchema);
export const BagLot = getModel<IBagLot>("BagLot", BagLotSchema);
export const BagEvent = getModel<IBagEvent>("BagEvent", BagEventSchema);
export const DamageClaim = getModel<IDamageClaim>("DamageClaim", DamageClaimSchema);
export const StoneDelivery = getModel<IStoneDelivery>("StoneDelivery", StoneDeliverySchema);
export const ShiftReport = getModel<IShiftReport>("ShiftReport", ShiftReportSchema);
export const Invoice = getModel<IInvoice>("Invoice", InvoiceSchema);
export const PurchaseRequest = getModel<IPurchaseRequest>("PurchaseRequest", PurchaseRequestSchema);
export const Receipt = getModel<IReceipt>("Receipt", ReceiptSchema);
export const PushSubscription = getModel<IPushSubscription>("PushSubscription", PushSubscriptionSchema);
export const Brief = getModel<IBrief>("Brief", BriefSchema);
export const TelegramSession = getModel<ITelegramSession>("TelegramSession", TelegramSessionSchema);
