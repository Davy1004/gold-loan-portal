-- Money rules: gold value is stored as integer PAISE, loans as integer RUPEES. No floats.
CREATE TABLE IF NOT EXISTS loan_schemes (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL,
  repayment_type        TEXT NOT NULL CHECK (repayment_type IN ('BULLET', 'EMI')),
  annual_interest_rate  NUMERIC(5,2) NOT NULL CHECK (annual_interest_rate > 0),
  tenure_months         INTEGER NOT NULL CHECK (tenure_months > 0),
  max_ltv_bps           INTEGER NOT NULL CHECK (max_ltv_bps > 0 AND max_ltv_bps <= 7500),
  active                BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE SEQUENCE IF NOT EXISTS lead_application_seq START 1001;

CREATE TABLE IF NOT EXISTS leads (
  id                    BIGSERIAL PRIMARY KEY,
  application_id        TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  mobile                TEXT NOT NULL,
  gross_weight_mg       BIGINT NOT NULL,
  net_weight_mg         BIGINT NOT NULL,
  karat                 INTEGER NOT NULL CHECK (karat IN (18, 22, 24)),
  scheme_id             TEXT NOT NULL REFERENCES loan_schemes(id),
  rate_24k_paise_per_g  BIGINT NOT NULL,
  pure_gold_mg          BIGINT NOT NULL,
  gold_value_paise      BIGINT NOT NULL,
  eligible_loan_rupees  BIGINT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'SUBMITTED',
  source                TEXT NOT NULL DEFAULT 'FORM' CHECK (source IN ('FORM', 'AGENT')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_weight_mg > 0 AND net_weight_mg <= gross_weight_mg AND gross_weight_mg <= 1000000)
);

CREATE INDEX IF NOT EXISTS leads_mobile_created_idx ON leads (mobile, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            TEXT PRIMARY KEY,
  request_hash   TEXT NOT NULL,
  status_code    INTEGER NOT NULL,
  response       JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
