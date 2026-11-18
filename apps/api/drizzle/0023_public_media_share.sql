-- Public lookup of one publication for its share link (MED-05, change exh-media-share).
-- Same visibility as the public map: READY, not hidden, exhibitor consented, event still running.
-- SECURITY DEFINER because the link carries no tenant; it returns only what the share page needs.
CREATE FUNCTION public_media_share(p_media uuid)
RETURNS TABLE (
  id uuid, kind text, storage_key text, content_type text, caption text, alt text,
  duration_s integer, exhibitor_name text, event_name text, event_slug text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.kind, p.storage_key, p.content_type, p.caption, p.alt, p.duration_s,
         x.trade_name, ev.name, ev.slug
  FROM exhibitor_photos p
  JOIN exhibitors x ON x.tenant_id = p.tenant_id AND x.id = p.exhibitor_id
  JOIN events ev ON ev.tenant_id = p.tenant_id AND ev.id = p.event_id
  JOIN tenants t ON t.id = p.tenant_id
  WHERE p.id = p_media
    AND p.status = 'READY'
    AND p.event_id IS NOT NULL
    AND x.public_contact_opt_in = true
    AND ev.status IN ('PUBLISHED', 'ACTIVE')
    AND ev.ends_at > now()
    AND t.status = 'ACTIVE'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public_media_share(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public_media_share(uuid) TO juntta_app;
