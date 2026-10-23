/**
 * Politiques de limitation de débit (fenêtre fixe, compteurs en base). Valeurs de départ raisonnables,
 * NON calibrées sur du trafic réel : à ajuster avec les premiers usages (D-021).
 */
export interface RatePolicy {
  name: string;
  limit: number;
  windowSeconds: number;
}

const MIN = 60;
const HOUR = 3600;

export const RATE_POLICIES = {
  loginIp: { name: "login_ip", limit: 20, windowSeconds: 10 * MIN },
  registerIp: { name: "register_ip", limit: 10, windowSeconds: HOUR },
  forgotIp: { name: "forgot_ip", limit: 5, windowSeconds: HOUR },
  forgotEmail: { name: "forgot_email", limit: 3, windowSeconds: HOUR },
  resetIp: { name: "reset_ip", limit: 10, windowSeconds: HOUR },
  confirmDeliveryUser: { name: "confirm_delivery_user", limit: 20, windowSeconds: 10 * MIN },
  uploadUser: { name: "upload_user", limit: 30, windowSeconds: HOUR },
  disputeUser: { name: "dispute_user", limit: 10, windowSeconds: HOUR },
  disputeMessageUser: { name: "dispute_message_user", limit: 60, windowSeconds: HOUR },
  reviewUser: { name: "review_user", limit: 30, windowSeconds: HOUR },
} as const satisfies Record<string, RatePolicy>;
