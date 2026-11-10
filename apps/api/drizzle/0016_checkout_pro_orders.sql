-- PAY-01/PAY-02: Checkout Pro moves from Preferences to the Orders API. The attempt now stores
-- the provider's order id; existing values are kept (data-safe rename).
ALTER TABLE "payment_attempts" RENAME COLUMN "preference_id" TO "provider_checkout_id";--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_checkout_unique" ON "payment_attempts" USING btree ("provider_checkout_id") WHERE "payment_attempts"."provider_checkout_id" IS NOT NULL;--> statement-breakpoint
-- PAY-03: an Orders notification carries no tenant (the URL is set in the Mercado Pago panel).
-- The tenant is resolved from OUR stored order id. SECURITY DEFINER because RLS hides the
-- attempts until the tenant is known (same pattern as exhibitor_invitation_lookup, 0008).
CREATE FUNCTION payment_attempt_tenant(p_checkout_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id FROM payment_attempts WHERE provider_checkout_id = p_checkout_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION payment_attempt_tenant(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION payment_attempt_tenant(text) TO juntta_app;
