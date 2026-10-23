import { ROLE_LABELS, formatDate } from "@/lib/format";
import type { ShipmentReviews, ReviewView } from "@/server/reviews";
import { ReviewForm } from "./review-form";
import { Card } from "./ui";

export const stars = (n: number) => `${"★".repeat(n)}${"☆".repeat(5 - n)}`;

function ReviewLine({ title, review }: { title: string; review: ReviewView }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
      <p className="text-xs text-slate-500">
        {title} · {review.authorName} ({ROLE_LABELS[review.authorRole]}) · {formatDate(review.createdAt)}
      </p>
      <p className="mt-1">
        <span aria-label={`${review.rating} sur 5`} className="text-amber-600">
          {stars(review.rating)}
        </span>{" "}
        {review.rating}/5
      </p>
      {review.comment ? <p className="mt-1 whitespace-pre-wrap">{review.comment}</p> : null}
    </div>
  );
}

/** Avis de fin de transport : le sien, celui de l'autre partie, et le formulaire tant que le délai court. */
export function ReviewSection({ status, reviews, counterpartName, shipmentId }: { status: string; reviews: ShipmentReviews; counterpartName: string; shipmentId: string }) {
  if (status !== "DELIVERED" && !reviews.mine && !reviews.theirs) return null;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Avis</h2>
      <div className="space-y-3">
        {reviews.mine ? <ReviewLine title="Votre avis" review={reviews.mine} /> : null}
        {reviews.theirs ? <ReviewLine title="Avis reçu" review={reviews.theirs} /> : null}
        {reviews.canReview ? (
          <ReviewForm shipmentId={shipmentId} counterpartName={counterpartName} />
        ) : !reviews.mine && status === "DELIVERED" ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Le délai pour déposer un avis est dépassé.</p>
        ) : null}
        {reviews.windowEndsAt && reviews.canReview ? (
          <p className="text-xs text-slate-500">Vous pouvez noter jusqu&apos;au {formatDate(reviews.windowEndsAt)}. Un avis est public et ne peut plus être modifié.</p>
        ) : null}
      </div>
    </Card>
  );
}
