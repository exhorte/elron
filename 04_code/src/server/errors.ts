/** Erreur métier/HTTP maîtrisée. Le message est destiné à l'utilisateur ; `code` est stable pour les clients. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (message = "Authentification requise") => new AppError(401, "unauthorized", message);
export const forbidden = (code = "forbidden", message = "Action non autorisée") => new AppError(403, code, message);
export const notFound = (what = "Ressource") => new AppError(404, "not_found", `${what} introuvable`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const invalid = (code: string, message: string, details?: unknown) => new AppError(422, code, message, details);
export const tooManyRequests = (code: string, message: string) => new AppError(429, code, message);
export const locked = (code: string, message: string) => new AppError(423, code, message);
