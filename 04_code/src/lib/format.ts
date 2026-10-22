import type { MatchFlag, ExclusionReason } from "@/domain/matching";

/**
 * Dakar et Abidjan sont toutes deux en GMT (UTC+0) toute l'année : en MVP les dates sont saisies et
 * affichées en GMT, et signalées comme telles (voir DECISIONS_LOG D-011). À remplacer par un fuseau par
 * ville lorsque d'autres couloirs seront ouverts.
 */
const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const dateOnly = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" });

export const formatDateTime = (d: Date | string): string => `${dateTime.format(new Date(d))} GMT`;
export const formatDate = (d: Date | string): string => dateOnly.format(new Date(d));

/** `datetime-local` (« 2026-11-05T14:30 ») → ISO GMT. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00Z` : null;
}

export const TRANSPORT_LABELS: Record<string, string> = {
  air: "Avion",
  bus: "Bus",
  car: "Voiture",
  train: "Train",
  other: "Autre",
};

export const IDENTITY_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  verified: { label: "Identité vérifiée par un opérateur", tone: "ok" },
  declared: { label: "Identité déclarée, non vérifiée", tone: "warn" },
  rejected: { label: "Vérification refusée", tone: "warn" },
  not_provided: { label: "Identité non renseignée", tone: "muted" },
};

export const FLAG_LABELS: Record<MatchFlag, string> = {
  arrival_unknown: "Arrivée non déclarée",
  volume_unknown: "Volume disponible non déclaré",
  no_history: "Aucun historique sur la plateforme",
  identity_unverified: "Identité non vérifiée",
  price_not_comparable: "Prix en devises différentes : non comparables",
  over_budget: "Au-dessus de votre budget",
  budget_currency_differs: "Devise différente de votre budget",
  review_category: "Marchandise à vérifier à la remise",
  after_deadline: "Arrivée après votre échéance",
};

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  own_offer: "Votre propre offre",
  offer_not_published: "Offre non active",
  provider_not_active: "Transporteur suspendu",
  route_mismatch: "Autre trajet",
  already_departed: "Déjà parti",
  deposit_cutoff_passed: "Date limite de dépôt passée",
  before_earliest_departure: "Part avant la date souhaitée",
  after_latest_departure: "Part après la date limite",
  insufficient_weight: "Capacité insuffisante",
  insufficient_volume: "Volume insuffisant",
  category_not_accepted: "Catégorie non acceptée",
  category_prohibited: "Catégorie interdite",
  over_budget_strict: "Dépasse le budget strict",
  after_deadline_strict: "Arrive après l'échéance stricte",
};

export const CRITERIA_LABELS: Record<string, string> = {
  price: "Prix",
  dateProximity: "Proximité de la date",
  reliability: "Fiabilité (historique)",
  delay: "Délai",
  headroom: "Marge de capacité",
};

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  requested: "En attente de réponse",
  accepted: "Acceptée",
  rejected: "Refusée",
  cancelled: "Annulée",
  superseded: "Remplacée par une autre réservation",
};

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  open: "Ouverte",
  booked: "Réservée",
  cancelled: "Annulée",
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  published: "Publiée",
  closed: "Clôturée",
  cancelled: "Annulée",
};

export const ROLE_LABELS: Record<string, string> = {
  sender: "Expéditeur",
  provider: "Transporteur",
  operator: "Opérateur",
  system: "Système",
};

export const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Connectez-vous pour continuer.",
  email_taken: "Cette adresse e-mail est déjà utilisée.",
  invalid_credentials: "E-mail ou mot de passe incorrect.",
  account_locked: "Trop de tentatives. Réessayez dans quelques minutes.",
  account_suspended: "Ce compte est suspendu.",
  traveler_profile_required: "Créez d'abord votre profil voyageur.",
  route_not_enabled: "Ce trajet n'est pas encore ouvert sur la plateforme.",
  category_prohibited: "Cette catégorie de marchandise est interdite par la politique de la plateforme.",
  offer_incompatible: "Cette offre n'est plus compatible avec votre demande.",
  booking_already_requested: "Vous avez déjà demandé cette offre.",
  insufficient_capacity: "La capacité restante est insuffisante.",
  delivery_code_invalid: "Code incorrect.",
  delivery_code_locked: "Trop de tentatives : l'expéditeur doit générer un nouveau code.",
  delivery_code_expired: "Code expiré : l'expéditeur doit en générer un nouveau.",
  delivery_code_not_generated: "L'expéditeur n'a pas encore généré le code de remise.",
  note_required: "Une justification est requise.",
  invalid_transition: "Ce changement de statut n'est pas possible.",
  transition_forbidden: "Vous ne pouvez pas effectuer ce changement de statut.",
};
