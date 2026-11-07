-- REVIEW REQUIRED. All routines participate in the caller's transaction.
SET lock_timeout='3s';
SET statement_timeout='60s';

CREATE FUNCTION public.marketing_card_state(p_driver uuid)
RETURNS TABLE(id uuid,cycle integer,credits bigint,held bigint,completed_at timestamptz,redeemed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.id,c.cycle,count(p.id) FILTER(WHERE p.status<>'REVERSED'),
 count(p.id) FILTER(WHERE p.status='HELD'),c.completed_at,
 EXISTS(SELECT 1 FROM driver_reward_redemption_cards r WHERE r.card_id=c.id)
 FROM driver_loyalty_cards c LEFT JOIN driver_loyalty_punches p ON p.card_id=c.id
 WHERE c.driver_id=p_driver GROUP BY c.id ORDER BY c.cycle;
$$;
CREATE FUNCTION public.marketing_next_card(p_driver uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c uuid;
BEGIN
 PERFORM 1 FROM marketing_drivers WHERE id=p_driver FOR UPDATE;
 SELECT id INTO c FROM marketing_card_state(p_driver) WHERE credits<12 AND NOT redeemed ORDER BY cycle LIMIT 1;
 IF c IS NULL THEN
  INSERT INTO driver_loyalty_cards(driver_id,cycle) SELECT p_driver,coalesce(max(cycle),0)+1 FROM driver_loyalty_cards WHERE driver_id=p_driver RETURNING id INTO c;
 END IF;
 RETURN c;
END; $$;
CREATE FUNCTION public.marketing_exception_signature(p_driver uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(coalesce(string_agg(concat_ws('|',c.id,c.credits,c.held,
   (SELECT string_agg(concat_ws(':',p.id,p.status),',' ORDER BY p.id) FROM driver_loyalty_punches p WHERE p.card_id=c.id)), ';' ORDER BY c.id),''))
 FROM marketing_card_state(p_driver) c WHERE c.redeemed AND (c.credits<12 OR c.held>0);
$$;
CREATE FUNCTION public.marketing_credit_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner_id uuid;
BEGIN
 PERFORM marketing_lock();
 SELECT driver_id INTO owner_id FROM driver_loyalty_cards WHERE id=NEW.card_id FOR UPDATE;
 IF NEW.visit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM taxi_visits WHERE id=NEW.visit_id AND driver_id=owner_id) THEN RAISE EXCEPTION 'CREDIT_DRIVER_MISMATCH'; END IF;
 IF NEW.opening_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM driver_loyalty_openings WHERE id=NEW.opening_id AND driver_id=owner_id) THEN RAISE EXCEPTION 'CREDIT_DRIVER_MISMATCH'; END IF;
 IF NEW.status<>'REVERSED' AND (SELECT count(*) FROM driver_loyalty_punches WHERE card_id=NEW.card_id AND id<>NEW.id AND status<>'REVERSED')>=12 THEN RAISE EXCEPTION 'CARD_OVERFLOW'; END IF;
 IF TG_OP='UPDATE' AND (OLD.card_id<>NEW.card_id OR OLD.source<>NEW.source OR OLD.visit_id IS DISTINCT FROM NEW.visit_id OR OLD.opening_id IS DISTINCT FROM NEW.opening_id) THEN RAISE EXCEPTION 'CREDIT_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER marketing_credit_integrity BEFORE INSERT OR UPDATE ON driver_loyalty_punches FOR EACH ROW EXECUTE FUNCTION marketing_credit_integrity();
CREATE FUNCTION public.marketing_redemption_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE redemption driver_reward_redemptions; c record;
BEGIN
 PERFORM marketing_lock();
 SELECT * INTO redemption FROM driver_reward_redemptions WHERE id=NEW.redemption_id;
 SELECT * INTO c FROM marketing_card_state(redemption.driver_id) WHERE id=NEW.card_id;
 IF c.id IS NULL OR c.credits<>12 OR c.held>0 OR c.redeemed THEN RAISE EXCEPTION 'CARD_NOT_REDEEMABLE'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER marketing_redemption_integrity BEFORE INSERT ON driver_reward_redemption_cards FOR EACH ROW EXECUTE FUNCTION marketing_redemption_integrity();
CREATE FUNCTION public.marketing_redemption_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (SELECT count(*) FROM driver_reward_redemption_cards WHERE redemption_id=NEW.id)<>(NEW.reward_snapshot->>'cards_required')::int THEN RAISE EXCEPTION 'REDEMPTION_CARD_COUNT'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER marketing_redemption_complete AFTER INSERT ON driver_reward_redemptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketing_redemption_complete();
CREATE FUNCTION public.marketing_refresh_cards(p_driver uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record;
BEGIN
 FOR c IN SELECT * FROM marketing_card_state(p_driver) LOOP
  IF c.credits>12 THEN RAISE EXCEPTION 'CARD_OVERFLOW'; END IF;
  IF c.credits=12 AND c.completed_at IS NULL THEN
    UPDATE driver_loyalty_cards SET completed_at=now() WHERE id=c.id;
    PERFORM marketing_audit('CARD_COMPLETED',c.id,NULL,jsonb_build_object('driver_id',p_driver));
  ELSIF c.credits<12 AND c.completed_at IS NOT NULL AND NOT c.redeemed THEN
    UPDATE driver_loyalty_cards SET completed_at=NULL WHERE id=c.id;
    PERFORM marketing_audit('CARD_REOPENED',c.id,to_jsonb(c),NULL);
  END IF;
  IF c.redeemed AND (c.credits<12 OR c.held>0) THEN
    UPDATE marketing_drivers SET redemption_exception=true WHERE id=p_driver AND NOT redemption_exception
     AND acknowledged_exception_signature IS DISTINCT FROM marketing_exception_signature(p_driver);
  END IF;
 END LOOP;
END; $$;
CREATE FUNCTION public.marketing_visit_signature(p_visit uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(coalesce(string_agg(concat_ws('|',id,version,invoice_key,business_date,allocated_guests,state,last_sale_id,last_amount,last_status,voided_at),';' ORDER BY id),''))
 FROM taxi_visit_bills WHERE visit_id=p_visit;
$$;
CREATE FUNCTION public.marketing_refresh_punch(p_visit uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v taxi_visits; p driver_loyalty_punches; qualifying boolean; clean boolean; wanted text; signature text;
BEGIN
 SELECT * INTO v FROM taxi_visits WHERE id=p_visit;
 SELECT * INTO p FROM driver_loyalty_punches WHERE visit_id=p_visit;
 SELECT coalesce(sum(allocated_guests),0)>0, count(*)>0 AND bool_and(state='MATCHED') INTO qualifying,clean
 FROM taxi_visit_bills WHERE visit_id=p_visit AND voided_at IS NULL;
 signature:=marketing_visit_signature(p_visit);
 IF v.voided_at IS NOT NULL OR NOT v.brought_guests THEN
   IF p.id IS NOT NULL AND p.status<>'REVERSED' THEN
    UPDATE driver_loyalty_punches SET status='REVERSED',verified_signature=NULL,version=version+1 WHERE id=p.id;
    PERFORM marketing_audit('PUNCH_REVERSED',p.id,to_jsonb(p),jsonb_build_object('status','REVERSED'),'VISIT_VOID');
   END IF;
 ELSE
   wanted:=CASE WHEN qualifying AND (clean OR p.verified_signature=signature) THEN 'CONFIRMED' ELSE 'HELD' END;
   IF p.id IS NULL AND qualifying THEN
    INSERT INTO driver_loyalty_punches(card_id,visit_id,source,status)
    VALUES(marketing_next_card(v.driver_id),v.id,'VISIT',wanted) RETURNING * INTO p;
    PERFORM marketing_audit('PUNCH_CREATED',p.id,NULL,to_jsonb(p));
   ELSIF p.id IS NOT NULL AND p.status<>'REVERSED' AND p.status<>wanted THEN
    UPDATE driver_loyalty_punches SET status=wanted,version=version+1 WHERE id=p.id;
    PERFORM marketing_audit('PUNCH_STATE',p.id,to_jsonb(p),jsonb_build_object('status',wanted));
   END IF;
   IF p.id IS NOT NULL THEN
    INSERT INTO driver_loyalty_punch_bills(punch_id,bill_id) SELECT p.id,id FROM taxi_visit_bills WHERE visit_id=v.id ON CONFLICT DO NOTHING;
   END IF;
 END IF;
 PERFORM marketing_refresh_cards(v.driver_id);
END; $$;

CREATE FUNCTION public.marketing_reconcile(p_reason text DEFAULT 'SOURCE_CHANGED',p_dates date[] DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b record; s sales_orders; n integer; claims integer; v_state text; chosen uuid; v uuid;
BEGIN
 PERFORM marketing_lock();
 -- Release all claims before reassignment so a new duplicate is shown as a
 -- conflict on both visits, never arbitrarily awarded to the first writer.
 UPDATE taxi_visit_bills SET sale_id=NULL WHERE sale_id IS NOT NULL AND (p_dates IS NULL OR business_date=ANY(p_dates));
 FOR b IN SELECT bl.*,tv.voided_at AS visit_voided FROM taxi_visit_bills bl JOIN taxi_visits tv ON tv.id=bl.visit_id
   WHERE p_dates IS NULL OR bl.business_date=ANY(p_dates) ORDER BY bl.id LOOP
   s:=NULL; chosen:=NULL;
   IF b.voided_at IS NOT NULL OR b.visit_voided IS NOT NULL THEN v_state:='VOID';
   ELSE
    SELECT count(*),(array_agg(id ORDER BY id))[1] INTO n,chosen FROM sales_orders
     WHERE business_date=b.business_date AND marketing_invoice(invoice_no)=b.invoice_key;
    IF b.selected_sale_id IS NOT NULL AND EXISTS(SELECT 1 FROM sales_orders WHERE id=b.selected_sale_id
      AND business_date=b.business_date AND marketing_invoice(invoice_no)=b.invoice_key) THEN n:=1;chosen:=b.selected_sale_id; END IF;
    SELECT count(*) INTO claims FROM taxi_visit_bills x JOIN taxi_visits xv ON xv.id=x.visit_id
      WHERE x.business_date=b.business_date AND x.invoice_key=b.invoice_key AND x.voided_at IS NULL AND xv.voided_at IS NULL;
    IF claims>1 THEN v_state:='CONFLICT';
    ELSIF n>1 THEN v_state:='AMBIGUOUS';
    ELSIF n=0 THEN
     IF b.ever_matched THEN v_state:='SOURCE_REMOVED';
     ELSIF EXISTS(SELECT 1 FROM sales_import_batches WHERE business_date=b.business_date AND report_type='ORDERS_MASTER') THEN v_state:='UNMATCHED';
     ELSE v_state:='PENDING_IMPORT'; END IF;
    ELSE
     SELECT * INTO s FROM sales_orders WHERE id=chosen;
     v_state:=CASE WHEN s.status='Success' THEN 'MATCHED' ELSE 'NON_SUCCESS' END;
    END IF;
   END IF;
   IF v_state IS DISTINCT FROM b.state OR s.id IS DISTINCT FROM b.last_sale_id OR s.net_sales IS DISTINCT FROM b.last_amount OR s.status IS DISTINCT FROM b.last_status THEN
    INSERT INTO taxi_bill_reconciliation_events(bill_id,before_state,after_state,sale_id,batch_id,amount,sale_status,reason,actor_id)
      VALUES(b.id,b.state,v_state,s.id,s.batch_id,s.net_sales,s.status,p_reason,auth.uid());
   END IF;
   UPDATE taxi_visit_bills SET state=v_state,
     sale_id=CASE WHEN v_state='MATCHED' THEN s.id END,
     last_sale_id=s.id,last_batch_id=s.batch_id,last_amount=s.net_sales,last_status=s.status,
     ever_matched=ever_matched OR v_state='MATCHED' WHERE id=b.id;
 END LOOP;
 FOR v IN SELECT DISTINCT visit_id FROM taxi_visit_bills WHERE p_dates IS NULL OR business_date=ANY(p_dates) LOOP PERFORM marketing_refresh_punch(v); END LOOP;
END; $$;
CREATE FUNCTION public.marketing_sales_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF coalesce(current_setting('yatra.atomic_orders',true),'')<>'on' THEN PERFORM marketing_reconcile('SOURCE_'||TG_OP); END IF;
 RETURN NULL;
END; $$;
CREATE TRIGGER marketing_sales_changed AFTER INSERT OR UPDATE OR DELETE ON sales_orders FOR EACH STATEMENT EXECUTE FUNCTION marketing_sales_changed();
CREATE TRIGGER marketing_batches_changed AFTER INSERT OR DELETE ON sales_import_batches FOR EACH STATEMENT EXECUTE FUNCTION marketing_sales_changed();
CREATE FUNCTION public.marketing_sales_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM marketing_lock(); RETURN NULL; END; $$;
CREATE TRIGGER marketing_sales_lock BEFORE INSERT OR UPDATE OR DELETE ON sales_orders FOR EACH STATEMENT EXECUTE FUNCTION marketing_sales_lock();
CREATE TRIGGER marketing_batch_lock BEFORE INSERT OR UPDATE OR DELETE ON sales_import_batches FOR EACH STATEMENT EXECUTE FUNCTION marketing_sales_lock();

CREATE FUNCTION public.marketing_mutate(p_action text,p_request uuid,p_data jsonb,p_client_version integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor uuid:=auth.uid(); req marketing_requests; result jsonb; old jsonb; d marketing_drivers; car marketing_vehicles;
 visit taxi_visits; bill taxi_visit_bills; punch driver_loyalty_punches; reward driver_reward_catalog;
 v_id uuid; card uuid; rate taxi_incentive_rates; location uuid; category text; required text; reconcile_dates date[];
 reason text:=nullif(trim(p_data->>'reason'),''); i integer; credits integer; cards uuid[]; stamp timestamptz:=now();
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 required:=CASE
 WHEN p_action IN ('register','arrival','bill','incentive','finalize') THEN 'marketing.capture'
 WHEN p_action IN ('driver','vehicle','associate','void_visit','rate') THEN 'marketing.manage'
 WHEN p_action='resolve_bill' THEN 'marketing.reconcile'
 WHEN p_action IN ('opening','adjust_opening','review_punch','resolve_exception') THEN 'marketing.loyalty'
 WHEN p_action='redeem' THEN 'marketing.redeem' ELSE NULL END;
 IF required IS NULL THEN RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE='22023'; END IF;
 -- Managers may complete other staff's visits; reconciliation staff can edit bills.
 IF NOT (marketing_can(required) OR (p_action IN ('bill','incentive','finalize') AND marketing_can('marketing.manage'))
    OR (p_action='bill' AND marketing_can('marketing.reconcile'))) THEN PERFORM marketing_assert(required); END IF;
 IF NOT EXISTS(SELECT 1 FROM marketing_feature_settings WHERE enabled AND minimum_client_version<=p_client_version) THEN
  RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE='55000'; END IF;
 PERFORM marketing_lock();
 IF p_data ? 'actual_amount' AND ((p_data->>'actual_amount') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$') THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
 IF p_data ? 'amount' AND ((p_data->>'amount') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$') THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
 SELECT * INTO req FROM marketing_requests WHERE actor_id=actor AND request_id=p_request;
 IF FOUND THEN
   IF req.action<>p_action OR req.payload<>p_data THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
   RETURN req.result;
 END IF;

 IF p_action='register' THEN
   IF nullif(p_data->>'driver_id','') IS NOT NULL THEN
    SELECT * INTO d FROM marketing_drivers WHERE id=(p_data->>'driver_id')::uuid AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE'; END IF;
   ELSE
    INSERT INTO marketing_drivers(name,phone,created_by) VALUES(trim(p_data->>'name'),p_data->>'phone',actor) RETURNING * INTO d;
   END IF;
   IF nullif(p_data->>'vehicle_id','') IS NOT NULL THEN
    SELECT * INTO car FROM marketing_vehicles WHERE id=(p_data->>'vehicle_id')::uuid AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'VEHICLE_UNAVAILABLE'; END IF;
   ELSE
    INSERT INTO marketing_vehicles(registration,make_model,category_code,created_by)
     VALUES(p_data->>'registration',coalesce(p_data->>'make_model',''),p_data->>'category_code',actor) RETURNING * INTO car;
   END IF;
   INSERT INTO marketing_driver_vehicles(driver_id,vehicle_id,created_by,reason) VALUES(d.id,car.id,actor,coalesce(reason,'REGISTRATION')) ON CONFLICT DO NOTHING;
   v_id:=d.id; result:=jsonb_build_object('driver',to_jsonb(d),'vehicle',to_jsonb(car));
 ELSIF p_action IN ('driver','vehicle') THEN
   IF reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
   v_id:=(p_data->>'id')::uuid;
   IF p_action='driver' THEN
    SELECT to_jsonb(x) INTO old FROM marketing_drivers x WHERE x.id=v_id AND version=(p_data->>'version')::int FOR UPDATE;
    IF old IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
    UPDATE marketing_drivers SET name=coalesce(p_data->>'name',name),phone=coalesce(p_data->>'phone',phone),
      is_active=coalesce((p_data->>'is_active')::boolean,is_active),version=version+1,updated_at=now() WHERE marketing_drivers.id=v_id RETURNING to_jsonb(marketing_drivers.*) INTO result;
   ELSE
    SELECT to_jsonb(x) INTO old FROM marketing_vehicles x WHERE x.id=v_id AND version=(p_data->>'version')::int FOR UPDATE;
    IF old IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
    UPDATE marketing_vehicles SET registration=coalesce(p_data->>'registration',registration),make_model=coalesce(p_data->>'make_model',make_model),
     category_code=coalesce(p_data->>'category_code',category_code),is_active=coalesce((p_data->>'is_active')::boolean,is_active),version=version+1
     WHERE marketing_vehicles.id=v_id RETURNING to_jsonb(marketing_vehicles.*) INTO result;
   END IF;
 ELSIF p_action='associate' THEN
   IF reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
   IF p_data->>'end'='true' THEN
    UPDATE marketing_driver_vehicles SET effective_to=now() WHERE driver_id=(p_data->>'driver_id')::uuid AND vehicle_id=(p_data->>'vehicle_id')::uuid AND effective_to IS NULL RETURNING marketing_driver_vehicles.id INTO v_id;
   ELSE
    INSERT INTO marketing_driver_vehicles(driver_id,vehicle_id,created_by,reason)
      VALUES((p_data->>'driver_id')::uuid,(p_data->>'vehicle_id')::uuid,actor,reason) RETURNING marketing_driver_vehicles.id INTO v_id;
   END IF;
   IF v_id IS NULL THEN RAISE EXCEPTION 'ASSOCIATION_NOT_FOUND'; END IF;
   result:=jsonb_build_object('id',v_id);
 ELSIF p_action='arrival' THEN
   SELECT * INTO d FROM marketing_drivers WHERE marketing_drivers.id=(p_data->>'driver_id')::uuid AND is_active;
   SELECT * INTO car FROM marketing_vehicles WHERE marketing_vehicles.id=(p_data->>'vehicle_id')::uuid AND is_active;
   IF d.id IS NULL OR car.id IS NULL OR NOT EXISTS(SELECT 1 FROM marketing_driver_vehicles WHERE driver_id=d.id AND vehicle_id=car.id AND effective_to IS NULL) THEN RAISE EXCEPTION 'SELECT_ASSOCIATED_DRIVER'; END IF;
   SELECT * INTO rate FROM taxi_incentive_rates WHERE category_code=car.category_code
      AND valid_from<=(stamp AT TIME ZONE 'Asia/Kolkata')::date AND (valid_to IS NULL OR valid_to>(stamp AT TIME ZONE 'Asia/Kolkata')::date);
   IF rate.id IS NULL THEN RAISE EXCEPTION 'RATE_UNAVAILABLE'; END IF;
   INSERT INTO taxi_visits(driver_id,vehicle_id,driver_name_snapshot,registration_snapshot,category_code,brought_guests,rate_id,eligible_amount,collection_status,created_by)
   VALUES(d.id,car.id,d.name,car.registration,car.category_code,(p_data->>'brought_guests')::boolean,rate.id,
     CASE WHEN (p_data->>'brought_guests')::boolean THEN rate.amount ELSE 0 END,
     CASE WHEN (p_data->>'brought_guests')::boolean THEN 'PENDING' ELSE 'NOT_APPLICABLE' END,actor) RETURNING * INTO visit;
   v_id:=visit.id;
   IF nullif(p_data->>'manual_event_id','') IS NOT NULL THEN
    UPDATE vehicle_counter_events SET taxi_visit_id=visit.id,vehicle_category=car.category_code,event_source='TAXI_ATTACHED'
      WHERE vehicle_counter_events.id=(p_data->>'manual_event_id')::uuid AND taxi_visit_id IS NULL AND voided_at IS NULL AND increment=1
      AND entered_by=actor AND business_date=visit.business_date AND timestamp>=stamp-interval '30 minutes'
      AND coalesce(lower(vehicle_prefix),'')<>'bike'
      AND NOT EXISTS(SELECT 1 FROM vehicle_origin_locations l WHERE l.id=location_id AND lower(l.name)='bike');
    IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_EVENT_INELIGIBLE'; END IF;
   ELSE
    -- An unrecognized registration is stored as Unknown, never a fabricated RTO.
    SELECT l.id INTO location FROM vehicle_origin_locations l WHERE l.is_active AND upper(l.name)=
      (SELECT p.prefix FROM vehicle_registration_prefixes p WHERE p.is_active AND car.registration_normalized LIKE upper(p.prefix)||'%' ORDER BY length(p.prefix) DESC LIMIT 1) LIMIT 1;
    IF location IS NULL THEN SELECT l.id INTO location FROM vehicle_origin_locations l WHERE l.is_active AND lower(l.name)='others'; END IF;
    IF location IS NULL THEN RAISE EXCEPTION 'ORIGIN_UNAVAILABLE'; END IF;
    INSERT INTO vehicle_counter_events(business_date,timestamp,location_id,increment,entered_by,vehicle_prefix,vehicle_category,event_source,taxi_visit_id)
      VALUES(visit.business_date,visit.arrived_at,location,1,actor,
        coalesce((SELECT p.prefix FROM vehicle_registration_prefixes p WHERE p.is_active AND car.registration_normalized LIKE upper(p.prefix)||'%' ORDER BY length(p.prefix) DESC LIMIT 1),'Unknown'),car.category_code,'TAXI',visit.id);
   END IF;
   result:=to_jsonb(visit);
 ELSIF p_action IN ('bill','incentive','finalize','void_visit','resolve_bill') THEN
   SELECT * INTO visit FROM taxi_visits WHERE taxi_visits.id=(p_data->>'visit_id')::uuid FOR UPDATE;
   IF visit.id IS NULL THEN RAISE EXCEPTION 'VISIT_NOT_FOUND'; END IF;
   IF visit.version IS DISTINCT FROM (p_data->>'version')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
   IF visit.voided_at IS NOT NULL THEN RAISE EXCEPTION 'VISIT_VOID'; END IF;
   IF visit.finalized_at IS NOT NULL AND p_action<>'resolve_bill' AND NOT marketing_can('marketing.manage') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
   IF NOT marketing_can('marketing.manage') AND NOT (p_action IN ('bill','resolve_bill') AND marketing_can('marketing.reconcile'))
     AND (visit.created_by<>actor OR visit.finalized_at IS NOT NULL) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
   IF visit.finalized_at IS NOT NULL AND reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
   old:=to_jsonb(visit); v_id:=visit.id;
   IF p_action='bill' THEN
    IF NOT visit.brought_guests THEN RAISE EXCEPTION 'NO_GUEST_VISIT'; END IF;
    IF nullif(p_data->>'bill_id','') IS NOT NULL THEN
     IF reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
     SELECT * INTO bill FROM taxi_visit_bills WHERE taxi_visit_bills.id=(p_data->>'bill_id')::uuid AND visit_id=visit.id AND voided_at IS NULL;
     IF NOT FOUND THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
     PERFORM marketing_audit('BILL_BEFORE',bill.id,to_jsonb(bill),p_data,reason);
     UPDATE taxi_visit_bills SET invoice_no=coalesce(p_data->>'invoice_no',invoice_no),business_date=coalesce((p_data->>'business_date')::date,business_date),
       allocated_guests=coalesce((p_data->>'allocated_guests')::int,allocated_guests),version=version+1,selected_sale_id=NULL,
       voided_at=CASE WHEN p_data->>'void'='true' THEN now() ELSE NULL END WHERE taxi_visit_bills.id=bill.id;
    ELSE
     IF (p_data->>'business_date')::date<>visit.business_date AND reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
     INSERT INTO taxi_visit_bills(visit_id,invoice_no,business_date,allocated_guests,created_by)
       VALUES(visit.id,p_data->>'invoice_no',coalesce((p_data->>'business_date')::date,visit.business_date),(p_data->>'allocated_guests')::int,actor);
    END IF;
   ELSIF p_action='resolve_bill' THEN
    IF reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    UPDATE taxi_visit_bills SET selected_sale_id=(p_data->>'sale_id')::uuid,version=version+1
     WHERE taxi_visit_bills.id=(p_data->>'bill_id')::uuid AND visit_id=visit.id AND voided_at IS NULL
     AND EXISTS(SELECT 1 FROM sales_orders s WHERE s.id=(p_data->>'sale_id')::uuid AND s.business_date=taxi_visit_bills.business_date AND marketing_invoice(s.invoice_no)=invoice_key);
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SALE_CANDIDATE'; END IF;
   ELSIF p_action='incentive' THEN
    IF NOT visit.brought_guests THEN RAISE EXCEPTION 'NO_GUEST_VISIT'; END IF;
    IF p_data->>'collection_status' NOT IN ('PENDING','GIVEN','NOT_COLLECTED') THEN RAISE EXCEPTION 'INVALID_COLLECTION_STATUS'; END IF;
    IF (p_data->>'actual_amount')::numeric<>visit.eligible_amount AND p_data->>'collection_status'<>'PENDING' AND reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    UPDATE taxi_visits SET actual_amount=(p_data->>'actual_amount')::numeric,collection_status=p_data->>'collection_status',incentive_reason=reason WHERE taxi_visits.id=visit.id;
   ELSIF p_action='void_visit' THEN
    IF reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    UPDATE taxi_visits SET voided_at=now(),void_reason=reason WHERE taxi_visits.id=visit.id;
    UPDATE vehicle_counter_events SET voided_at=now() WHERE taxi_visit_id=visit.id;
   ELSE
    IF visit.brought_guests AND (visit.collection_status='PENDING' OR NOT EXISTS(SELECT 1 FROM taxi_visit_bills WHERE visit_id=visit.id AND voided_at IS NULL AND allocated_guests>0)) THEN RAISE EXCEPTION 'VISIT_INCOMPLETE'; END IF;
    UPDATE taxi_visits SET finalized_at=now() WHERE taxi_visits.id=visit.id;
   END IF;
   UPDATE taxi_visits SET version=version+1 WHERE taxi_visits.id=visit.id RETURNING to_jsonb(taxi_visits.*) INTO result;
   IF p_action IN ('bill','void_visit','resolve_bill') THEN
    SELECT array_agg(DISTINCT business_date) INTO reconcile_dates FROM taxi_visit_bills WHERE visit_id=visit.id;
    -- Include the old key after a correction so another claimant is released.
    IF bill.business_date IS NOT NULL THEN reconcile_dates:=array_append(reconcile_dates,bill.business_date); END IF;
    PERFORM marketing_reconcile('VISIT_CHANGED',reconcile_dates);
   END IF;
 ELSIF p_action IN ('opening','adjust_opening') THEN
   SELECT * INTO d FROM marketing_drivers WHERE marketing_drivers.id=(p_data->>'driver_id')::uuid AND is_active FOR UPDATE;
   IF d.id IS NULL THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE'; END IF;
   IF p_action='opening' AND EXISTS(SELECT 1 FROM driver_loyalty_punches p JOIN driver_loyalty_cards c ON c.id=p.card_id WHERE c.driver_id=d.id) THEN RAISE EXCEPTION 'OPENING_ALREADY_STARTED' USING ERRCODE='23505'; END IF;
   IF p_action='adjust_opening' AND (reason IS NULL OR NOT EXISTS(SELECT 1 FROM driver_loyalty_openings WHERE driver_id=d.id)) THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
   INSERT INTO driver_loyalty_openings(driver_id,saved_cards,partial_credits,reference,evidence,approved_by)
     VALUES(d.id,(p_data->>'saved_cards')::int,(p_data->>'partial_credits')::int,p_data->>'reference',p_data->>'evidence',actor) RETURNING driver_loyalty_openings.id INTO v_id;
   credits:=(p_data->>'saved_cards')::int*12+(p_data->>'partial_credits')::int;
   FOR i IN 1..credits LOOP
    card:=marketing_next_card(d.id);
    INSERT INTO driver_loyalty_punches(card_id,opening_id,source,status) VALUES(card,v_id,'OPENING_BALANCE','CONFIRMED');
    PERFORM marketing_refresh_cards(d.id);
   END LOOP;
   result:=jsonb_build_object('id',v_id,'credits',credits);
 ELSIF p_action='review_punch' THEN
   IF reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
   SELECT * INTO punch FROM driver_loyalty_punches WHERE driver_loyalty_punches.id=(p_data->>'punch_id')::uuid FOR UPDATE;
   IF punch.id IS NULL THEN RAISE EXCEPTION 'PUNCH_NOT_FOUND'; END IF;
   IF punch.version IS DISTINCT FROM (p_data->>'version')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
   IF p_data->>'status' NOT IN ('REVERSED','CONFIRMED') THEN RAISE EXCEPTION 'INVALID_PUNCH_STATE'; END IF;
   IF p_data->>'status'='CONFIRMED' AND punch.status='REVERSED' THEN RAISE EXCEPTION 'REVERSED_PUNCH_IMMUTABLE'; END IF;
   IF p_data->>'status'='CONFIRMED' AND punch.visit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM taxi_visits v JOIN taxi_visit_bills b ON b.visit_id=v.id
     WHERE v.id=punch.visit_id AND v.voided_at IS NULL AND v.brought_guests AND b.voided_at IS NULL AND b.allocated_guests>0) THEN RAISE EXCEPTION 'VISIT_INCOMPLETE'; END IF;
   v_id:=punch.id; old:=to_jsonb(punch);
   UPDATE driver_loyalty_punches SET status=p_data->>'status',verified_signature=CASE WHEN p_data->>'status'='CONFIRMED' THEN marketing_visit_signature(punch.visit_id) END,
      review_reason=reason,reviewed_by=actor,version=version+1 WHERE driver_loyalty_punches.id=punch.id RETURNING to_jsonb(driver_loyalty_punches.*) INTO result;
   SELECT driver_id INTO v_id FROM driver_loyalty_cards WHERE driver_loyalty_cards.id=punch.card_id;
   PERFORM marketing_refresh_cards(v_id); v_id:=punch.id;
 ELSIF p_action='resolve_exception' THEN
   IF reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
   v_id:=(p_data->>'driver_id')::uuid;
   -- Explicit acknowledgement retains the reward and original invalid credits.
   UPDATE marketing_drivers SET redemption_exception=false,acknowledged_exception_signature=marketing_exception_signature(v_id),version=version+1 WHERE marketing_drivers.id=v_id RETURNING to_jsonb(marketing_drivers.*) INTO result;
   IF result IS NULL THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE'; END IF;
 ELSIF p_action='redeem' THEN
   SELECT * INTO d FROM marketing_drivers WHERE marketing_drivers.id=(p_data->>'driver_id')::uuid AND is_active FOR UPDATE;
   IF d.id IS NULL OR d.redemption_exception THEN RAISE EXCEPTION 'REDEMPTION_HELD'; END IF;
   SELECT * INTO reward FROM driver_reward_catalog WHERE code=p_data->>'reward_code' AND is_active;
   IF reward.code IS NULL THEN RAISE EXCEPTION 'REWARD_UNAVAILABLE'; END IF;
   SELECT array_agg(c.id ORDER BY c.cycle) INTO cards FROM (
     SELECT cs.* FROM marketing_card_state(d.id) cs WHERE cs.credits=12 AND cs.held=0 AND NOT cs.redeemed ORDER BY cs.cycle LIMIT reward.cards_required
   ) c;
   IF coalesce(cardinality(cards),0)<>reward.cards_required THEN RAISE EXCEPTION 'INSUFFICIENT_CARDS' USING ERRCODE='23505'; END IF;
   INSERT INTO driver_reward_redemptions(driver_id,reward_code,reward_snapshot,reference,created_by)
      VALUES(d.id,reward.code,to_jsonb(reward),p_data->>'reference',actor) RETURNING driver_reward_redemptions.id INTO v_id;
   INSERT INTO driver_reward_redemption_cards(redemption_id,card_id) SELECT v_id,unnest(cards);
   result:=jsonb_build_object('id',v_id,'cards',cards,'reward',to_jsonb(reward));
 ELSIF p_action='rate' THEN
   IF reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
   IF (p_data->>'valid_from')::date<=(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'FUTURE_RATE_REQUIRED'; END IF;
   UPDATE taxi_incentive_rates SET valid_to=(p_data->>'valid_from')::date WHERE category_code=p_data->>'category_code' AND valid_to IS NULL;
   INSERT INTO taxi_incentive_rates(category_code,valid_from,amount) VALUES(p_data->>'category_code',(p_data->>'valid_from')::date,(p_data->>'amount')::numeric) RETURNING taxi_incentive_rates.id INTO v_id;
   result:=jsonb_build_object('id',v_id);
 END IF;
 result:=marketing_money_json(result);
 PERFORM marketing_audit(upper(p_action),v_id,old,result,reason);
 INSERT INTO marketing_requests VALUES(actor,p_request,p_action,p_data,result,now());
 RETURN result;
END; $$;

-- Internal functions cannot be invoked directly to bypass authorization.
REVOKE ALL ON FUNCTION marketing_card_state(uuid),marketing_next_card(uuid),marketing_refresh_cards(uuid),marketing_exception_signature(uuid),marketing_visit_signature(uuid),marketing_refresh_punch(uuid),marketing_reconcile(text,date[]),marketing_sales_changed() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION marketing_mutate(text,uuid,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION marketing_sales_lock() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION marketing_credit_integrity(),marketing_redemption_integrity(),marketing_redemption_complete() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION marketing_mutate(text,uuid,jsonb,integer) TO authenticated;
