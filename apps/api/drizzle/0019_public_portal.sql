-- PUB-01: the public portal reads published events without a session, so the request carries no
-- tenant. Same pattern as exhibitor_invitation_lookup (0008) and payment_attempt_tenant (0016):
-- two SECURITY DEFINER functions are the only cross-tenant reads. The first resolves a slug to
-- (event, tenant) of an event on sale; every other read then runs in withTenant under RLS.
-- The second lists what the catalog may show and exposes nothing but publishable columns: no ids,
-- prices, reservations, payments or exhibitors.
CREATE FUNCTION public_event_lookup(p_slug text)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.tenant_id FROM events e
  JOIN tenants t ON t.id = e.tenant_id
  WHERE e.slug = p_slug AND e.status IN ('PUBLISHED', 'ACTIVE') AND t.status = 'ACTIVE'
$$;--> statement-breakpoint
CREATE FUNCTION public_event_list()
RETURNS TABLE (
  slug text, name text, tenant_name text, venue_name text, venue_address text,
  starts_at timestamptz, ends_at timestamptz, sales_open_at timestamptz, sales_close_at timestamptz,
  total_stands integer, available_stands integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.slug, e.name, t.name, v.name, v.address,
         e.starts_at, e.ends_at, e.sales_open_at, e.sales_close_at,
         (SELECT count(*)::integer FROM event_stands s
           WHERE s.event_id = e.id AND s.status <> 'DISABLED'),
         (SELECT count(*)::integer FROM event_stands s
           WHERE s.event_id = e.id AND s.status = 'AVAILABLE' AND s.price_cents IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM reservations r
               WHERE r.event_stand_id = s.id
                 AND r.status IN ('HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'REFUND_PENDING')))
  FROM events e
  JOIN tenants t ON t.id = e.tenant_id
  JOIN venues v ON v.tenant_id = e.tenant_id AND v.id = e.venue_id
  WHERE e.status IN ('PUBLISHED', 'ACTIVE') AND t.status = 'ACTIVE'
  ORDER BY e.starts_at, e.slug
  LIMIT 100
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public_event_lookup(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public_event_list() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public_event_lookup(text) TO juntta_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public_event_list() TO juntta_app;
