CREATE TYPE "public"."actor_role" AS ENUM('sender', 'provider', 'operator', 'system');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('requested', 'accepted', 'rejected', 'cancelled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."identity_status" AS ENUM('not_provided', 'declared', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('published', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('user', 'operator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('open', 'booked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('ACCEPTED', 'HANDED_OVER', 'IN_TRANSIT', 'ARRIVED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'DAMAGED', 'LOST', 'DISPUTED', 'RETURNED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."transport_mode" AS ENUM('air', 'bus', 'car', 'train', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"provider_user_id" uuid NOT NULL,
	"weight_g" integer NOT NULL,
	"volume_l" integer,
	"status" "booking_status" DEFAULT 'requested' NOT NULL,
	"price_per_kg_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"platform_fee_minor" integer NOT NULL,
	"provider_net_minor" integer NOT NULL,
	"fee_bps" integer NOT NULL,
	"message" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_weight_positive" CHECK ("bookings"."weight_g" > 0),
	CONSTRAINT "bookings_amounts_non_negative" CHECK ("bookings"."subtotal_minor" >= 0 AND "bookings"."platform_fee_minor" >= 0 AND "bookings"."provider_net_minor" >= 0),
	CONSTRAINT "bookings_amounts_consistent" CHECK ("bookings"."provider_net_minor" + "bookings"."platform_fee_minor" = "bookings"."subtotal_minor"),
	CONSTRAINT "bookings_parties_distinct" CHECK ("bookings"."sender_user_id" <> "bookings"."provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "capacity_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_user_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"transport_mode" "transport_mode" NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"arrival_estimated_at" timestamp with time zone,
	"deposit_cutoff_at" timestamp with time zone,
	"capacity_weight_g" integer NOT NULL,
	"reserved_weight_g" integer DEFAULT 0 NOT NULL,
	"capacity_volume_l" integer,
	"reserved_volume_l" integer DEFAULT 0 NOT NULL,
	"price_per_kg_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"accepted_categories" text[] NOT NULL,
	"handover_terms" text,
	"deposit_address" text,
	"pickup_address" text,
	"status" "offer_status" DEFAULT 'published' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_capacity_positive" CHECK ("capacity_offers"."capacity_weight_g" > 0),
	CONSTRAINT "offers_reserved_within_capacity" CHECK ("capacity_offers"."reserved_weight_g" >= 0 AND "capacity_offers"."reserved_weight_g" <= "capacity_offers"."capacity_weight_g"),
	CONSTRAINT "offers_volume_within_capacity" CHECK ("capacity_offers"."reserved_volume_l" >= 0 AND ("capacity_offers"."capacity_volume_l" IS NULL OR "capacity_offers"."reserved_volume_l" <= "capacity_offers"."capacity_volume_l")),
	CONSTRAINT "offers_price_non_negative" CHECK ("capacity_offers"."price_per_kg_minor" >= 0),
	CONSTRAINT "offers_arrival_after_departure" CHECK ("capacity_offers"."arrival_estimated_at" IS NULL OR "capacity_offers"."arrival_estimated_at" >= "capacity_offers"."departure_at"),
	CONSTRAINT "offers_categories_not_empty" CHECK (cardinality("capacity_offers"."accepted_categories") > 0)
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"country_code" char(2) NOT NULL,
	"name" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" text PRIMARY KEY NOT NULL,
	"origin_city_id" text NOT NULL,
	"destination_city_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "routes_distinct_cities" CHECK ("routes"."origin_city_id" <> "routes"."destination_city_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "shipment_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"shipment_id" uuid NOT NULL,
	"from_status" "shipment_status",
	"to_status" "shipment_status" NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "actor_role" NOT NULL,
	"note" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proofs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"declared_value_minor" integer,
	CONSTRAINT "shipment_items_quantity_positive" CHECK ("shipment_items"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "shipment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"weight_g" integer NOT NULL,
	"length_cm" integer,
	"width_cm" integer,
	"height_cm" integer,
	"volume_l" integer,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"declared_value_minor" integer,
	"declared_value_currency" char(3),
	"budget_max_minor" integer,
	"budget_currency" char(3),
	"budget_is_strict" boolean DEFAULT false NOT NULL,
	"earliest_departure_at" timestamp with time zone,
	"latest_departure_at" timestamp with time zone,
	"needed_by" timestamp with time zone,
	"deadline_is_strict" boolean DEFAULT false NOT NULL,
	"receiver_name" text NOT NULL,
	"receiver_phone" text NOT NULL,
	"status" "request_status" DEFAULT 'open' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_weight_positive" CHECK ("shipment_requests"."weight_g" > 0),
	CONSTRAINT "requests_budget_consistent" CHECK (("shipment_requests"."budget_max_minor" IS NULL) = ("shipment_requests"."budget_currency" IS NULL)),
	CONSTRAINT "requests_declared_value_consistent" CHECK (("shipment_requests"."declared_value_minor" IS NULL) = ("shipment_requests"."declared_value_currency" IS NULL)),
	CONSTRAINT "requests_window_ordered" CHECK ("shipment_requests"."earliest_departure_at" IS NULL OR "shipment_requests"."latest_departure_at" IS NULL OR "shipment_requests"."earliest_departure_at" <= "shipment_requests"."latest_departure_at")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_code" text NOT NULL,
	"booking_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"provider_user_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"status" "shipment_status" DEFAULT 'ACCEPTED' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weight_g" integer NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"declared_value_minor" integer,
	"declared_value_currency" char(3),
	"receiver_name" text NOT NULL,
	"receiver_phone" text NOT NULL,
	"delivery_code_hash" text,
	"delivery_code_generation" integer DEFAULT 0 NOT NULL,
	"delivery_code_expires_at" timestamp with time zone,
	"delivery_code_attempts" integer DEFAULT 0 NOT NULL,
	"delivery_code_locked_at" timestamp with time zone,
	"delivery_code_consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_weight_positive" CHECK ("shipments"."weight_g" > 0),
	CONSTRAINT "shipments_attempts_non_negative" CHECK ("shipments"."delivery_code_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "traveler_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"bio" text,
	"declared_legal_name" text,
	"declared_id_kind" text,
	"identity_status" "identity_status" DEFAULT 'not_provided' NOT NULL,
	"identity_declared_at" timestamp with time zone,
	"identity_reviewed_by" uuid,
	"identity_reviewed_at" timestamp with time zone,
	"identity_review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traveler_verified_requires_reviewer" CHECK ("traveler_profiles"."identity_status" <> 'verified' OR ("traveler_profiles"."identity_reviewed_by" IS NOT NULL AND "traveler_profiles"."identity_reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"platform_role" "platform_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_request_id_shipment_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."shipment_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offer_id_capacity_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."capacity_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_user_id_users_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_offers" ADD CONSTRAINT "capacity_offers_provider_user_id_users_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_offers" ADD CONSTRAINT "capacity_offers_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_destination_city_id_cities_id_fk" FOREIGN KEY ("destination_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_requests" ADD CONSTRAINT "shipment_requests_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_requests" ADD CONSTRAINT "shipment_requests_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_request_id_shipment_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."shipment_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_offer_id_capacity_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."capacity_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_provider_user_id_users_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_identity_reviewed_by_users_id_fk" FOREIGN KEY ("identity_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "bookings_offer_idx" ON "bookings" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "bookings_sender_idx" ON "bookings" USING btree ("sender_user_id");--> statement-breakpoint
CREATE INDEX "bookings_provider_idx" ON "bookings" USING btree ("provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_active_pair_key" ON "bookings" USING btree ("request_id","offer_id") WHERE "bookings"."status" IN ('requested','accepted');--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_accepted_per_request_key" ON "bookings" USING btree ("request_id") WHERE "bookings"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "offers_search_idx" ON "capacity_offers" USING btree ("route_id","departure_at") WHERE "capacity_offers"."status" = 'published';--> statement-breakpoint
CREATE INDEX "offers_provider_idx" ON "capacity_offers" USING btree ("provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_pair_key" ON "routes" USING btree ("origin_city_id","destination_city_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_idx" ON "shipment_events" USING btree ("shipment_id","id");--> statement-breakpoint
CREATE INDEX "shipment_items_shipment_idx" ON "shipment_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "requests_sender_idx" ON "shipment_requests" USING btree ("sender_user_id");--> statement-breakpoint
CREATE INDEX "requests_open_route_idx" ON "shipment_requests" USING btree ("route_id") WHERE "shipment_requests"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_tracking_code_key" ON "shipments" USING btree ("tracking_code");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_booking_key" ON "shipments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "shipments_sender_idx" ON "shipments" USING btree ("sender_user_id");--> statement-breakpoint
CREATE INDEX "shipments_provider_idx" ON "shipments" USING btree ("provider_user_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");