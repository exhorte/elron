CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "dispute_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dispute_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dispute_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_role" "actor_role" NOT NULL,
	"body" text NOT NULL,
	"proofs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_messages_kind_known" CHECK ("dispute_messages"."kind" IN ('message','opening','resolution'))
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"opener_role" "actor_role" NOT NULL,
	"reason_code" text NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"status_before" "shipment_status" NOT NULL,
	"resolution_outcome" text,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_reason_known" CHECK ("disputes"."reason_code" IN ('not_received','damaged_goods','content_mismatch','delay','lost','conduct','other')),
	CONSTRAINT "disputes_outcome_known" CHECK ("disputes"."resolution_outcome" IS NULL OR "disputes"."resolution_outcome" IN ('resume','delivered','returned','lost','damaged','cancelled')),
	CONSTRAINT "disputes_resolution_complete" CHECK (("disputes"."status" = 'open' AND "disputes"."resolved_at" IS NULL AND "disputes"."resolved_by" IS NULL AND "disputes"."resolution_outcome" IS NULL)
          OR ("disputes"."status" = 'resolved' AND "disputes"."resolved_at" IS NOT NULL AND "disputes"."resolved_by" IS NOT NULL AND "disputes"."resolution_outcome" IS NOT NULL AND "disputes"."resolution_note" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispute_messages_dispute_idx" ON "dispute_messages" USING btree ("dispute_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_one_open_per_shipment_key" ON "disputes" USING btree ("shipment_id") WHERE "disputes"."status" = 'open';--> statement-breakpoint
CREATE INDEX "disputes_shipment_idx" ON "disputes" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","created_at");
--> statement-breakpoint
CREATE TRIGGER dispute_messages_append_only
  BEFORE UPDATE OR DELETE ON dispute_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
