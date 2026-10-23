import { z } from "zod";
import { GOODS_CATEGORY_CODES } from "@/config/goods-policy";
import { PROOF_PURPOSES } from "@/config/uploads";
import { DISPUTE_OUTCOMES, DISPUTE_REASONS } from "@/domain/disputes";
import { CURRENCY_CODES, type CurrencyCode } from "@/domain/money";
import { SHIPMENT_STATUSES } from "@/domain/workflow";

/** Schémas d'entrée (zod). Tous stricts : les champs inconnus sont refusés (pas de mass-assignment). */

export function normalizePhone(raw: string): string {
  return raw.replace(/[\s().-]/g, "");
}

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(10, "10 caractères minimum").max(128);
const displayName = z.string().trim().min(2).max(80);
const phone = z.string().trim().transform(normalizePhone).pipe(z.string().regex(/^\+?\d{6,15}$/, "Numéro de téléphone invalide"));
const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const currency = z.enum(CURRENCY_CODES as [CurrencyCode, ...CurrencyCode[]]);
const cityId = z.string().regex(/^[a-z]{2}-[a-z0-9-]{2,40}$/, "Identifiant de ville invalide");
const money = z.number().int().min(0).max(1_000_000_000);
const longText = (max: number) => z.string().trim().max(max);

export const registerSchema = z.strictObject({
  email,
  password,
  displayName,
  phone: phone.optional(),
  asTraveler: z.boolean().default(false),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.strictObject({ email });
export const resetPasswordSchema = z.strictObject({
  token: z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/, "Jeton invalide"),
  password,
});

export const travelerProfileSchema = z.strictObject({
  bio: longText(500).nullish(),
  declaredLegalName: z.string().trim().min(2).max(120).nullish(),
  declaredIdKind: z.enum(["national_id", "passport", "residence_permit"]).nullish(),
});
export type TravelerProfileInput = z.infer<typeof travelerProfileSchema>;

export const offerCreateSchema = z.strictObject({
  originCityId: cityId,
  destinationCityId: cityId,
  transportMode: z.enum(["air", "bus", "car", "train", "other"]),
  departureAt: isoDate,
  arrivalEstimatedAt: isoDate.nullish(),
  depositCutoffAt: isoDate.nullish(),
  capacityWeightG: z.number().int().min(100).max(500_000),
  capacityVolumeL: z.number().int().min(1).max(5000).nullish(),
  pricePerKgMinor: money,
  currency,
  acceptedCategories: z.array(z.enum(GOODS_CATEGORY_CODES)).min(1).max(20),
  handoverTerms: longText(1000).nullish(),
  depositAddress: longText(300).nullish(),
  pickupAddress: longText(300).nullish(),
});
export type OfferCreateInput = z.infer<typeof offerCreateSchema>;

const itemSchema = z.strictObject({
  description: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(1000).default(1),
  declaredValueMinor: money.nullish(),
});

export const requestCreateSchema = z
  .strictObject({
    originCityId: cityId,
    destinationCityId: cityId,
    weightG: z.number().int().min(1).max(100_000),
    lengthCm: z.number().int().min(1).max(300).nullish(),
    widthCm: z.number().int().min(1).max(300).nullish(),
    heightCm: z.number().int().min(1).max(300).nullish(),
    category: z.enum(GOODS_CATEGORY_CODES),
    description: z.string().trim().min(3).max(500),
    items: z.array(itemSchema).max(20).default([]),
    declaredValueMinor: money.nullish(),
    declaredValueCurrency: currency.nullish(),
    budgetMaxMinor: money.nullish(),
    budgetCurrency: currency.nullish(),
    budgetIsStrict: z.boolean().default(false),
    earliestDepartureAt: isoDate.nullish(),
    latestDepartureAt: isoDate.nullish(),
    neededBy: isoDate.nullish(),
    deadlineIsStrict: z.boolean().default(false),
    receiverName: z.string().trim().min(2).max(120),
    receiverPhone: phone,
  })
  .superRefine((v, ctx) => {
    const dims = [v.lengthCm, v.widthCm, v.heightCm].filter((d) => d != null).length;
    if (dims !== 0 && dims !== 3) ctx.addIssue({ code: "custom", path: ["lengthCm"], message: "Fournir les trois dimensions ou aucune" });
    if ((v.declaredValueMinor == null) !== (v.declaredValueCurrency == null)) {
      ctx.addIssue({ code: "custom", path: ["declaredValueCurrency"], message: "Valeur déclarée et devise vont ensemble" });
    }
    if ((v.budgetMaxMinor == null) !== (v.budgetCurrency == null)) {
      ctx.addIssue({ code: "custom", path: ["budgetCurrency"], message: "Budget et devise vont ensemble" });
    }
    if (v.earliestDepartureAt && v.latestDepartureAt && v.earliestDepartureAt > v.latestDepartureAt) {
      ctx.addIssue({ code: "custom", path: ["latestDepartureAt"], message: "La date limite précède la date la plus proche" });
    }
    if (v.budgetIsStrict && v.budgetMaxMinor == null) {
      ctx.addIssue({ code: "custom", path: ["budgetIsStrict"], message: "Budget strict sans budget" });
    }
    if (v.deadlineIsStrict && !v.neededBy) {
      ctx.addIssue({ code: "custom", path: ["deadlineIsStrict"], message: "Échéance stricte sans échéance" });
    }
  });
export type RequestCreateInput = z.infer<typeof requestCreateSchema>;

export const bookingCreateSchema = z.strictObject({
  requestId: z.uuid(),
  offerId: z.uuid(),
  message: longText(500).nullish(),
});
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;

export const reasonSchema = z.strictObject({ reason: longText(500).nullish() });

const proofSchema = z.strictObject({
  fileId: z.uuid(), // fichier déjà téléversé via POST /shipments/{id}/proofs
  description: longText(200).nullish(),
});

export const transitionSchema = z.strictObject({
  to: z.enum(SHIPMENT_STATUSES),
  note: longText(500).nullish(),
  proofs: z.array(proofSchema).max(5).default([]),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

export const proofUploadFieldsSchema = z.strictObject({
  purpose: z.enum(PROOF_PURPOSES).default("other"),
});

const proofRefs = z.array(proofSchema).max(5).default([]);

export const openDisputeSchema = z.strictObject({
  reasonCode: z.enum(DISPUTE_REASONS),
  description: z.string().trim().min(10, "Décrivez le problème en au moins 10 caractères").max(2000),
  proofs: proofRefs,
});

export const disputeMessageSchema = z.strictObject({
  body: z.string().trim().min(1).max(2000),
  proofs: proofRefs,
});

export const resolveDisputeSchema = z.strictObject({
  outcome: z.enum(DISPUTE_OUTCOMES),
  note: z.string().trim().min(3, "Motivez la décision").max(1000),
});

export const reviewSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  comment: longText(500).nullish(),
});

export const confirmDeliverySchema = z.strictObject({ code: z.string().regex(/^\d{6}$/, "Code à 6 chiffres") });

export const identityReviewSchema = z.strictObject({
  decision: z.enum(["verified", "rejected"]),
  note: longText(500).nullish(),
});

export const userStatusSchema = z.strictObject({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(3).max(500),
});

const queryBool = z.enum(["0", "1", "true", "false"]).transform((v) => v === "1" || v === "true");

export const searchQuerySchema = z.strictObject({
  origin: cityId,
  destination: cityId,
  weightKg: z.coerce.number().positive().max(100),
  category: z.enum(GOODS_CATEGORY_CODES).optional(),
  departureFrom: isoDate.optional(),
  departureTo: isoDate.optional(),
  budgetMaxMinor: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  budgetCurrency: currency.optional(),
  demo: queryBool.optional(),
  explain: queryBool.optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
