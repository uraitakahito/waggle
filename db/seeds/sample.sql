-- db/seeds/sample.sql
--
-- Sample URLs used by local development and the prod-stack smoke test.
-- Idempotent: ON CONFLICT on the url_hash unique index lets repeated
-- `npm run db:seed` invocations skip rows already present.

INSERT INTO urls (url, labels) VALUES
    ('https://www.apple.com/',        ARRAY['Apple']),
    ('https://www.microsoft.com/',    ARRAY['Microsoft']),
    ('https://www.cloudflare.com/',   ARRAY['Cloudflare']),
    ('https://www.ana.co.jp/group/',  ARRAY['9202', 'ANAHoldings']),
    ('https://www.datadoghq.com/',    ARRAY['Datadog'])
ON CONFLICT (url_hash) DO NOTHING;
