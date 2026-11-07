-- REVIEW REQUIRED: prepared locally; do not apply without owner approval.
-- Additive schema. No historical sales, counters or loyalty are backfilled.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE public.marketing_feature_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  minimum_client_version integer NOT NULL DEFAULT 1
);
INSERT INTO public.marketing_feature_settings DEFAULT VALUES;

CREATE FUNCTION public.marketing_can(p_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p JOIN roles r ON r.id=p.role_id
    WHERE p.id=auth.uid() AND p.is_active AND (r.name='Admin' OR EXISTS (
      SELECT 1 FROM role_permissions rp JOIN permissions pe ON pe.id=rp.permission_id
      WHERE rp.role_id=r.id AND pe.code IN (p_code,'admin.manage')
    ))
  );
$$;
CREATE FUNCTION public.marketing_assert(p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT marketing_can(p_code) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
END;
$$;
-- All writes involving bills/cards/imports take the same short transaction lock.
-- Deterministic lock order avoids import-vs-redemption and bill-claim deadlocks.
CREATE FUNCTION public.marketing_lock() RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM set_config('lock_timeout','3s',true);
  PERFORM pg_advisory_xact_lock(2061106,1);
END;
$$;
CREATE FUNCTION public.marketing_registration(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(upper(normalize(trim(p_value),NFKC)), '[[:space:]-]', '', 'g');
$$;
CREATE FUNCTION public.marketing_phone(p_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE v text := regexp_replace(normalize(p_value,NFKC),'[[:space:]()+-]','','g');
BEGIN
  IF v ~ '^0[6-9][0-9]{9}$' THEN v:=substring(v from 2); END IF;
  IF v ~ '^[6-9][0-9]{9}$' THEN v:='91'||v; END IF;
  IF v !~ '^91[6-9][0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE' USING ERRCODE='22023'; END IF;
  RETURN '+'||v;
END;
$$;
CREATE FUNCTION public.marketing_invoice(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT upper(trim(p_value)); $$;

CREATE TABLE public.marketing_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
  phone text NOT NULL, phone_normalized text GENERATED ALWAYS AS (public.marketing_phone(phone)) STORED UNIQUE,
  is_active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), redemption_exception boolean NOT NULL DEFAULT false,
  acknowledged_exception_signature text
);
CREATE TABLE public.taxi_vehicle_categories (
  code text PRIMARY KEY CHECK(code IN ('CAR_5','CAR_7','TRAVELLER','BUS')),
  name text NOT NULL, name_hi text NOT NULL
);
INSERT INTO public.taxi_vehicle_categories VALUES
 ('CAR_5','5-seater car','5 सीट कार'),('CAR_7','7-seater car','7 सीट कार'),
 ('TRAVELLER','Traveller / Mini Bus','ट्रैवलर / मिनी बस'),('BUS','Large Bus','बड़ी बस');
CREATE TABLE public.taxi_incentive_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category_code text NOT NULL REFERENCES taxi_vehicle_categories(code),
  valid_from date NOT NULL, valid_to date, amount numeric(12,2) NOT NULL CHECK(amount>=0),
  CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE FUNCTION public.marketing_rate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM marketing_lock();
  IF EXISTS(SELECT 1 FROM taxi_incentive_rates r WHERE r.category_code=NEW.category_code AND r.id<>NEW.id
     AND daterange(r.valid_from,r.valid_to,'[)') && daterange(NEW.valid_from,NEW.valid_to,'[)')) THEN
    RAISE EXCEPTION 'RATE_OVERLAP' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER marketing_rate_guard BEFORE INSERT OR UPDATE ON taxi_incentive_rates
FOR EACH ROW EXECUTE FUNCTION marketing_rate_guard();
INSERT INTO taxi_incentive_rates(category_code,valid_from,amount) VALUES
 ('CAR_5','2026-11-06',50),('CAR_7','2026-11-06',100),('TRAVELLER','2026-11-06',300),('BUS','2026-11-06',600);
CREATE TABLE public.marketing_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), registration text NOT NULL,
  registration_normalized text GENERATED ALWAYS AS(public.marketing_registration(registration)) STORED UNIQUE,
  make_model text NOT NULL DEFAULT '', category_code text NOT NULL REFERENCES taxi_vehicle_categories(code),
  is_active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(registration_normalized ~ '^[A-Z0-9]{5,16}$')
);
CREATE TABLE public.marketing_driver_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL REFERENCES marketing_drivers(id),
  vehicle_id uuid NOT NULL REFERENCES marketing_vehicles(id), effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz, created_by uuid NOT NULL REFERENCES auth.users(id), reason text NOT NULL,
  CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE UNIQUE INDEX marketing_driver_vehicle_active ON marketing_driver_vehicles(driver_id,vehicle_id) WHERE effective_to IS NULL;
CREATE INDEX marketing_vehicle_drivers ON marketing_driver_vehicles(vehicle_id);
CREATE TABLE public.taxi_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL REFERENCES marketing_drivers(id),
  vehicle_id uuid NOT NULL REFERENCES marketing_vehicles(id), arrived_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  driver_name_snapshot text NOT NULL, registration_snapshot text NOT NULL,
  category_code text NOT NULL REFERENCES taxi_vehicle_categories(code), brought_guests boolean NOT NULL,
  rate_id uuid REFERENCES taxi_incentive_rates(id), eligible_amount numeric(12,2) NOT NULL CHECK(eligible_amount>=0),
  actual_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(actual_amount>=0),
  collection_status text NOT NULL CHECK(collection_status IN ('PENDING','GIVEN','NOT_COLLECTED','NOT_APPLICABLE')),
  incentive_reason text, voided_at timestamptz, void_reason text,
  finalized_at timestamptz, version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((collection_status='GIVEN' AND actual_amount>0) OR (collection_status<>'GIVEN' AND actual_amount=0)),
  CHECK((brought_guests AND collection_status<>'NOT_APPLICABLE') OR
    (NOT brought_guests AND collection_status='NOT_APPLICABLE' AND eligible_amount=0)),
  CHECK((arrived_at AT TIME ZONE 'Asia/Kolkata')::date=business_date)
);
CREATE INDEX taxi_visits_date ON taxi_visits(business_date,id);
CREATE INDEX taxi_visits_driver ON taxi_visits(driver_id,arrived_at DESC);
CREATE INDEX taxi_visits_open ON taxi_visits(created_by,business_date) WHERE finalized_at IS NULL AND voided_at IS NULL;
ALTER TABLE public.vehicle_counter_events
 ADD COLUMN vehicle_category text CHECK(vehicle_category IN ('CAR_5','CAR_7','TRAVELLER','BUS','BIKE','CAR')),
 ADD COLUMN event_source text,
 ADD COLUMN taxi_visit_id uuid UNIQUE REFERENCES taxi_visits(id),
 ADD COLUMN voided_at timestamptz;
CREATE INDEX vehicle_counter_events_business_date ON vehicle_counter_events(business_date);
CREATE TABLE public.taxi_visit_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid NOT NULL REFERENCES taxi_visits(id),
  invoice_no text NOT NULL CHECK(length(trim(invoice_no)) BETWEEN 1 AND 120),
  invoice_key text GENERATED ALWAYS AS(public.marketing_invoice(invoice_no)) STORED,
  business_date date NOT NULL, allocated_guests integer NOT NULL CHECK(allocated_guests BETWEEN 0 AND 1000),
  state text NOT NULL DEFAULT 'PENDING_IMPORT' CHECK(state IN
    ('PENDING_IMPORT','UNMATCHED','AMBIGUOUS','MATCHED','NON_SUCCESS','CONFLICT','SOURCE_REMOVED','VOID')),
  sale_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  selected_sale_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  last_sale_id uuid, last_batch_id uuid, last_amount numeric(12,2), last_status text,
  ever_matched boolean NOT NULL DEFAULT false, voided_at timestamptz,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id)
);
CREATE UNIQUE INDEX taxi_visit_bill_unique ON taxi_visit_bills(visit_id,business_date,invoice_key) WHERE voided_at IS NULL;
CREATE UNIQUE INDEX taxi_sale_claim_unique ON taxi_visit_bills(sale_id) WHERE sale_id IS NOT NULL AND voided_at IS NULL;
CREATE INDEX taxi_bill_key ON taxi_visit_bills(business_date,invoice_key);
CREATE INDEX sales_orders_bill_key ON sales_orders(business_date,public.marketing_invoice(invoice_no));
CREATE TABLE public.taxi_bill_reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bill_id uuid NOT NULL REFERENCES taxi_visit_bills(id),
  before_state text, after_state text NOT NULL, sale_id uuid, batch_id uuid, amount numeric(12,2), sale_status text,
  reason text NOT NULL, actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.driver_loyalty_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL REFERENCES marketing_drivers(id),
  cycle integer NOT NULL CHECK(cycle>0), completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(driver_id,cycle)
);
CREATE TABLE public.driver_loyalty_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL REFERENCES marketing_drivers(id),
  saved_cards integer NOT NULL CHECK(saved_cards BETWEEN 0 AND 100), partial_credits integer NOT NULL CHECK(partial_credits BETWEEN 0 AND 11),
  reference text NOT NULL CHECK(length(trim(reference))>0), evidence text NOT NULL CHECK(length(trim(evidence))>0),
  approved_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.driver_loyalty_punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_id uuid NOT NULL REFERENCES driver_loyalty_cards(id),
  visit_id uuid UNIQUE REFERENCES taxi_visits(id), opening_id uuid REFERENCES driver_loyalty_openings(id),
  source text NOT NULL CHECK(source IN ('VISIT','OPENING_BALANCE')),
  status text NOT NULL CHECK(status IN ('HELD','CONFIRMED','REVERSED')),
  verified_signature text, review_reason text, reviewed_by uuid REFERENCES auth.users(id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((source='VISIT' AND visit_id IS NOT NULL AND opening_id IS NULL) OR
        (source='OPENING_BALANCE' AND opening_id IS NOT NULL AND visit_id IS NULL))
);
CREATE INDEX loyalty_punch_card ON driver_loyalty_punches(card_id);
CREATE TABLE public.driver_loyalty_punch_bills (
 punch_id uuid REFERENCES driver_loyalty_punches(id), bill_id uuid REFERENCES taxi_visit_bills(id), PRIMARY KEY(punch_id,bill_id)
);
CREATE TABLE public.driver_reward_catalog (code text PRIMARY KEY, name text NOT NULL, name_hi text NOT NULL,
 cards_required integer NOT NULL CHECK(cards_required BETWEEN 1 AND 5), is_active boolean NOT NULL DEFAULT true);
INSERT INTO driver_reward_catalog VALUES
 ('DINNER_SET','Dinner Set','डिनर सेट',1,true),('IRON','Iron','प्रेस',1,true),('KETTLE','Kettle','केतली',1,true),
 ('THERMOS','Hot/Cold Thermos','गर्म/ठंडा थर्मस',1,true),('HEATER','Room Heater','रूम हीटर',2,true),
 ('MIXER','Mixer Grinder','मिक्सर ग्राइंडर',2,true),('MICROWAVE','Microwave','माइक्रोवेव',3,true),
 ('TV','TV','टीवी',4,true),('WASHING_MACHINE','Automatic Washing Machine','ऑटोमैटिक वॉशिंग मशीन',5,true);
CREATE TABLE public.driver_reward_redemptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL REFERENCES marketing_drivers(id),
 reward_code text NOT NULL REFERENCES driver_reward_catalog(code), reward_snapshot jsonb NOT NULL,
 reference text NOT NULL CHECK(length(trim(reference))>0), created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.driver_reward_redemption_cards (
 redemption_id uuid NOT NULL REFERENCES driver_reward_redemptions(id), card_id uuid PRIMARY KEY REFERENCES driver_loyalty_cards(id)
);
CREATE TABLE public.marketing_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text NOT NULL, entity_id uuid NOT NULL,
 old_values jsonb, new_values jsonb, reason text, actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_audit_entity ON marketing_audit_events(entity_id,created_at);
CREATE TABLE public.marketing_requests (
 actor_id uuid NOT NULL REFERENCES auth.users(id), request_id uuid NOT NULL, action text NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE public.sales_import_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_date date NOT NULL, revision bigint NOT NULL,
 batch_id uuid, checksum text, action text NOT NULL CHECK(action IN ('REPLACE','DELETE')),
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_date,revision)
);
ALTER TABLE public.sales_import_batches ADD COLUMN revision bigint NOT NULL DEFAULT 0;

CREATE FUNCTION public.marketing_audit(p_action text,p_id uuid,p_old jsonb,p_new jsonb,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO marketing_audit_events(action,entity_id,old_values,new_values,reason,actor_id)
 VALUES(p_action,p_id,p_old,p_new,p_reason,auth.uid());
$$;
CREATE FUNCTION public.marketing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY_HISTORY' USING ERRCODE='55000'; END; $$;
CREATE FUNCTION public.marketing_money_json(p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(p_value)='object' THEN
  SELECT coalesce(jsonb_object_agg(key,CASE WHEN key IN ('amount','eligible_amount','actual_amount','confirmed_revenue','last_amount','net_sales','total_net_sales','total_gross_sales')
    AND jsonb_typeof(value)='number' THEN to_jsonb(value#>>'{}') ELSE marketing_money_json(value) END),'{}') INTO result FROM jsonb_each(p_value);
  RETURN result;
 ELSIF jsonb_typeof(p_value)='array' THEN
  SELECT coalesce(jsonb_agg(marketing_money_json(value)),'[]') INTO result FROM jsonb_array_elements(p_value); RETURN result;
 END IF;
 RETURN p_value;
END; $$;
CREATE TRIGGER marketing_audit_immutable BEFORE UPDATE OR DELETE ON marketing_audit_events FOR EACH ROW EXECUTE FUNCTION marketing_immutable();
CREATE TRIGGER reconciliation_immutable BEFORE UPDATE OR DELETE ON taxi_bill_reconciliation_events FOR EACH ROW EXECUTE FUNCTION marketing_immutable();
CREATE TRIGGER revisions_immutable BEFORE UPDATE OR DELETE ON sales_import_revisions FOR EACH ROW EXECUTE FUNCTION marketing_immutable();

INSERT INTO permissions(module,action,code,description) VALUES
 ('operations','capture','marketing.capture','Record taxi arrivals and complete own open visits'),
 ('operations','view','marketing.view','View driver directory and taxi reports'),
 ('operations','manage','marketing.manage','Manage driver and vehicle identities and visit corrections'),
 ('operations','reconcile','marketing.reconcile','Review taxi bill reconciliation'),
 ('operations','loyalty','marketing.loyalty','Verify loyalty and physical opening balances'),
 ('operations','redeem','marketing.redeem','Redeem eligible saved cards')
 ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE p.code LIKE 'marketing.%' AND (
 r.name IN ('Admin','Owner','General Manager') OR
 (r.name='Gate Staff' AND p.code='marketing.capture') OR
 (r.name='Cashier' AND p.code IN ('marketing.capture','marketing.view')) OR
 (r.name='Accountant' AND p.code IN ('marketing.view','marketing.reconcile')))
 ON CONFLICT DO NOTHING;

-- Expose through permission-checked RPCs only; no direct client writes to history.
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['marketing_feature_settings','marketing_drivers','marketing_vehicles','marketing_driver_vehicles',
 'taxi_vehicle_categories','taxi_incentive_rates','taxi_visits','taxi_visit_bills','taxi_bill_reconciliation_events',
 'driver_loyalty_cards','driver_loyalty_punches','driver_loyalty_punch_bills','driver_loyalty_openings',
 'driver_reward_catalog','driver_reward_redemptions','driver_reward_redemption_cards','marketing_audit_events','marketing_requests','sales_import_revisions'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
   EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',n);
 END LOOP;
END; $$;
REVOKE EXECUTE ON FUNCTION marketing_assert(text),marketing_lock(),marketing_audit(text,uuid,jsonb,jsonb,text),marketing_rate_guard(),marketing_immutable() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION marketing_can(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marketing_can(text) TO authenticated;
