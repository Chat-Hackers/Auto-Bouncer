-- Run once in the Neon SQL Editor before using the deployed app.
-- Does not import local member data or create any public-facing database API.
CREATE TABLE IF NOT EXISTS bouncer_state (
  id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bouncer_data_object CHECK (jsonb_typeof(data) = 'object')
);
