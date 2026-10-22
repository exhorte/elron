import { getTravelerProfile } from "@/server/admin";
import { requireActor, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "user" }, async ({ db, actor }) => {
  const user = requireActor(actor);
  const profile = await getTravelerProfile(db, user.id);
  return {
    user,
    travelerProfile: profile
      ? {
          bio: profile.bio,
          declaredLegalName: profile.declaredLegalName,
          declaredIdKind: profile.declaredIdKind,
          identityStatus: profile.identityStatus,
        }
      : null,
  };
});
