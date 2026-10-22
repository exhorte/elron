import { upsertTravelerProfile } from "@/server/admin";
import { requireActor, route } from "@/server/http";
import { travelerProfileSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const PUT = route({ auth: "user", mutation: true }, async ({ db, actor, body, now }) => {
  const profile = await upsertTravelerProfile(db, requireActor(actor), await body(travelerProfileSchema), now);
  return {
    bio: profile.bio,
    declaredLegalName: profile.declaredLegalName,
    declaredIdKind: profile.declaredIdKind,
    identityStatus: profile.identityStatus,
  };
});
