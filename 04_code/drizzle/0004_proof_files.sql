CREATE TABLE "proof_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploader_role" "actor_role" NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_files_size_positive" CHECK ("proof_files"."size_bytes" > 0),
	CONSTRAINT "proof_files_content_type_allowed" CHECK ("proof_files"."content_type" IN ('image/jpeg','image/png','image/webp','application/pdf'))
);
--> statement-breakpoint
ALTER TABLE "proof_files" ADD CONSTRAINT "proof_files_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_files" ADD CONSTRAINT "proof_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proof_files_storage_key_key" ON "proof_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "proof_files_shipment_idx" ON "proof_files" USING btree ("shipment_id","created_at");
--> statement-breakpoint
CREATE TRIGGER proof_files_append_only
  BEFORE UPDATE OR DELETE ON proof_files
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
