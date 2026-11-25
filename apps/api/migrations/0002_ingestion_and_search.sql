-- 0002 first vertical slice: ingestion API keys and the time-partitioned event store.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  prefix           text NOT NULL UNIQUE CHECK (prefix ~ '^[A-Za-z0-9]{8}$'),
  key_hash         text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  default_service  text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz
);
CREATE INDEX api_keys_org_idx ON api_keys (organization_id, created_at DESC);

CREATE TABLE log_events (
  id               bigserial,
  organization_id  uuid NOT NULL,
  api_key_id       uuid,
  timestamp        timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  level            text NOT NULL CHECK (level IN ('trace', 'debug', 'info', 'warn', 'error', 'fatal')),
  service          text,
  host             text,
  source           text NOT NULL DEFAULT 'http',
  message          text NOT NULL,
  trace_id         text,
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (timestamp, id)
) PARTITION BY RANGE (timestamp);

-- Indexes on the parent cascade to every partition (PostgreSQL 11+).
CREATE INDEX log_events_org_time_idx ON log_events (organization_id, timestamp DESC);
CREATE INDEX log_events_org_service_time_idx ON log_events (organization_id, service, timestamp DESC);
CREATE INDEX log_events_org_level_time_idx ON log_events (organization_id, level, timestamp DESC);
CREATE INDEX log_events_attributes_idx ON log_events USING gin (attributes jsonb_path_ops);
CREATE INDEX log_events_message_trgm_idx ON log_events USING gin (message gin_trgm_ops);

-- Safety net for rows outside every daily partition; monitored and drained by LG-191.
CREATE TABLE log_events_default PARTITION OF log_events DEFAULT;

-- Creates one partition per UTC day in [p_from, p_to]. Idempotent; returns how many were created.
CREATE FUNCTION loglens_ensure_daily_partitions(p_from date, p_to date) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  d date := p_from;
  created integer := 0;
  part text;
BEGIN
  IF p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'invalid partition window % .. %', p_from, p_to;
  END IF;
  WHILE d <= p_to LOOP
    part := format('log_events_p%s', to_char(d, 'YYYYMMDD'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF log_events FOR VALUES FROM (%L) TO (%L)',
        part, (d::timestamp AT TIME ZONE 'UTC'), ((d + 1)::timestamp AT TIME ZONE 'UTC'));
      created := created + 1;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN created;
END;
$$;

SELECT loglens_ensure_daily_partitions((now() AT TIME ZONE 'UTC')::date - 31, (now() AT TIME ZONE 'UTC')::date + 7);
