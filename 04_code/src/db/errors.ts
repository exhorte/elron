/** Extrait le code SQLSTATE et la contrainte d'une erreur pg, même enveloppée par drizzle (`cause`). */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  let current = err as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current.code === "string" && current.code.length === 5) {
      return { code: current.code, constraint: typeof current.constraint === "string" ? current.constraint : undefined };
    }
    current = current.cause as typeof current;
  }
  return {};
}

export const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const info = pgError(err);
  return info.code === PG_UNIQUE_VIOLATION && (constraint === undefined || info.constraint === constraint);
}
