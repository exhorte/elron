CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"author_role" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_author_role_known" CHECK ("reviews"."author_role" IN ('sender','provider')),
	CONSTRAINT "reviews_not_self" CHECK ("reviews"."author_user_id" <> "reviews"."subject_user_id"),
	CONSTRAINT "reviews_comment_length" CHECK ("reviews"."comment" IS NULL OR char_length("reviews"."comment") <= 500)
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_one_per_author_per_shipment_key" ON "reviews" USING btree ("shipment_id","author_user_id");--> statement-breakpoint
CREATE INDEX "reviews_subject_idx" ON "reviews" USING btree ("subject_user_id","created_at");
--> statement-breakpoint
CREATE TRIGGER reviews_append_only
  BEFORE UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
