-- REVIEW REQUIRED. Application-only deployment must not run this file.
SET lock_timeout='3s';
SET statement_timeout='60s';
CREATE FUNCTION public.marketing_orders_import(p_request uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); req marketing_requests; batch sales_import_batches; rev bigint; result jsonb;
 day date:=(p_data->>'business_date')::date; row_data jsonb; sale sales_orders; seen text[]:=ARRAY[]::text[];
 previous_setting text:=coalesce(current_setting('yatra.atomic_orders',true),'');
BEGIN
 PERFORM marketing_assert('finance.sales'); PERFORM marketing_lock();
 IF p_request IS NULL OR day IS NULL OR p_data->>'action' NOT IN ('REPLACE','DELETE') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO req FROM marketing_requests WHERE actor_id=actor AND request_id=p_request;
 IF FOUND THEN
  IF req.action<>'orders_import' OR req.payload<>p_data THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN req.result;
 END IF;
 SELECT * INTO batch FROM sales_import_batches WHERE business_date=day AND report_type='ORDERS_MASTER' FOR UPDATE;
 SELECT coalesce(max(revision),0) INTO rev FROM sales_import_revisions WHERE business_date=day;
 IF p_data->>'action'='REPLACE' AND batch.id IS NOT NULL AND NOT coalesce((p_data->>'overwrite')::boolean,false) THEN
  RETURN jsonb_build_object('isDuplicate',true,'code','IMPORT_EXISTS','existingBatch',to_jsonb(batch),'expectedRevision',rev);
 END IF;
 IF coalesce((p_data->>'expected_revision')::bigint,-1)<>rev THEN
  RETURN jsonb_build_object('isDuplicate',batch.id IS NOT NULL,'code','REVISION_CONFLICT','existingBatch',to_jsonb(batch),'expectedRevision',rev);
 END IF;
 PERFORM set_config('yatra.atomic_orders','on',true);
 IF p_data->>'action'='DELETE' THEN
  IF batch.id IS NULL OR batch.id::text IS DISTINCT FROM p_data->>'batch_id' THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  DELETE FROM sales_import_batches WHERE id=batch.id;
 ELSE
  IF jsonb_typeof(p_data->'orders')<>'array' OR jsonb_array_length(p_data->'orders')=0 THEN RAISE EXCEPTION 'EMPTY_ORDERS_REPORT'; END IF;
  IF batch.id IS NULL THEN
   INSERT INTO sales_import_batches(report_type,business_date,file_name,file_checksum,record_count,total_net_sales,total_gross_sales,raw_metadata,imported_by,revision)
   VALUES('ORDERS_MASTER',day,p_data->>'file_name',p_data->>'checksum',jsonb_array_length(p_data->'orders'),0,0,coalesce(p_data->'metadata','{}'),actor,rev+1) RETURNING * INTO batch;
  END IF;
  FOR row_data IN SELECT value FROM jsonb_array_elements(p_data->'orders') LOOP
   sale:=jsonb_populate_record(NULL::sales_orders,row_data);
   IF sale.business_date IS DISTINCT FROM day OR sale.order_timestamp IS NULL OR nullif(trim(sale.invoice_no),'') IS NULL
     OR sale.status IS NULL OR sale.net_sales IS NULL OR sale.covers_pax IS NULL OR sale.covers_pax<0 THEN RAISE EXCEPTION 'INVALID_ORDER'; END IF;
   IF sale.invoice_no=ANY(seen) THEN RAISE EXCEPTION 'DUPLICATE_INVOICE'; END IF;
   seen:=array_append(seen,sale.invoice_no);
   INSERT INTO sales_orders(batch_id,business_date,invoice_no,order_timestamp,hour_of_day,biller,kot_numbers,payment_type,order_type,status,area,captain_name,customer_name,customer_phone,covers_pax,gross_amount,discount_amount,net_sales,tax_amount,round_off,waived_off,grand_total)
   VALUES(batch.id,day,sale.invoice_no,sale.order_timestamp,sale.hour_of_day,sale.biller,sale.kot_numbers,sale.payment_type,sale.order_type,sale.status,sale.area,sale.captain_name,sale.customer_name,sale.customer_phone,sale.covers_pax,sale.gross_amount,sale.discount_amount,sale.net_sales,sale.tax_amount,sale.round_off,sale.waived_off,sale.grand_total)
   ON CONFLICT(business_date,invoice_no) DO UPDATE SET batch_id=excluded.batch_id,order_timestamp=excluded.order_timestamp,hour_of_day=excluded.hour_of_day,
    biller=excluded.biller,kot_numbers=excluded.kot_numbers,payment_type=excluded.payment_type,order_type=excluded.order_type,status=excluded.status,area=excluded.area,
    captain_name=excluded.captain_name,customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,covers_pax=excluded.covers_pax,
    gross_amount=excluded.gross_amount,discount_amount=excluded.discount_amount,net_sales=excluded.net_sales,tax_amount=excluded.tax_amount,
    round_off=excluded.round_off,waived_off=excluded.waived_off,grand_total=excluded.grand_total;
  END LOOP;
  DELETE FROM sales_orders WHERE business_date=day AND NOT(invoice_no=ANY(seen));
  UPDATE sales_import_batches SET file_name=p_data->>'file_name',file_checksum=p_data->>'checksum',
   record_count=cardinality(seen),total_net_sales=(SELECT sum(net_sales) FROM sales_orders WHERE batch_id=batch.id),
   total_gross_sales=(SELECT sum(grand_total) FROM sales_orders WHERE batch_id=batch.id),
   raw_metadata=coalesce(p_data->'metadata','{}'),imported_by=actor,revision=rev+1 WHERE id=batch.id RETURNING * INTO batch;
 END IF;
 INSERT INTO sales_import_revisions(business_date,revision,batch_id,checksum,action,actor_id)
   VALUES(day,rev+1,batch.id,p_data->>'checksum',p_data->>'action',actor);
 PERFORM set_config('yatra.atomic_orders',previous_setting,true);
 PERFORM marketing_reconcile('ORDERS_'||(p_data->>'action'),ARRAY[day]);
 result:=marketing_money_json(jsonb_build_object('success',true,'batch',to_jsonb(batch),'reportType','ORDERS_MASTER','businessDate',day,
   'recordCount',CASE WHEN p_data->>'action'='DELETE' THEN 0 ELSE cardinality(seen) END,'revision',rev+1));
 INSERT INTO audit_logs(user_id,action,entity_type,entity_id,old_values,new_values)
   VALUES(actor,'ORDERS_'||(p_data->>'action'),'sales_import_batches',batch.id::text,NULL,result);
 INSERT INTO marketing_requests VALUES(actor,p_request,'orders_import',p_data,result,now());
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION marketing_orders_import(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marketing_orders_import(uuid,jsonb) TO authenticated;

CREATE VIEW public.marketing_visit_summary AS
 SELECT v.*,coalesce(b.guests,0) AS guests,coalesce(b.bill_count,0) AS bill_count,coalesce(b.unresolved,0) AS unresolved,
 coalesce(b.revenue,0)::numeric(14,2) AS confirmed_revenue,
 CASE WHEN v.voided_at IS NOT NULL THEN 'VOID'
 WHEN coalesce(b.bill_count,0)=0 THEN CASE WHEN v.brought_guests THEN 'AWAITING_BILLS' ELSE 'NO_GUESTS' END
 WHEN b.review>0 THEN 'REVIEW_REQUIRED' WHEN b.unresolved=0 THEN 'FULLY_RECONCILED'
 WHEN b.unresolved<b.bill_count THEN 'PARTIALLY_RECONCILED' ELSE 'PENDING' END AS reconciliation_state
 FROM taxi_visits v LEFT JOIN LATERAL (
  SELECT sum(b.allocated_guests) AS guests,count(*) AS bill_count,count(*) FILTER(WHERE b.state<>'MATCHED') AS unresolved,
   count(*) FILTER(WHERE b.state IN ('AMBIGUOUS','CONFLICT','NON_SUCCESS','SOURCE_REMOVED')) AS review,
   sum(CASE WHEN b.state='MATCHED' AND s.status='Success' THEN s.net_sales ELSE 0 END) AS revenue
  FROM taxi_visit_bills b LEFT JOIN sales_orders s ON s.id=b.sale_id WHERE b.visit_id=v.id AND b.voided_at IS NULL
 ) b ON true;
REVOKE ALL ON marketing_visit_summary FROM anon,authenticated;

CREATE FUNCTION public.marketing_read(p_mode text,p_filter jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; driver uuid:=(p_filter->>'driver_id')::uuid;
 search text:=trim(coalesce(p_filter->>'search','')); page integer:=greatest(coalesce((p_filter->>'page')::int,1),1);
 first_day date:=coalesce((p_filter->>'from')::date,(now() AT TIME ZONE 'Asia/Kolkata')::date);
 last_day date:=coalesce((p_filter->>'to')::date,(now() AT TIME ZONE 'Asia/Kolkata')::date);
BEGIN
 IF NOT(marketing_can('marketing.view') OR marketing_can('marketing.capture') OR marketing_can('marketing.manage')) THEN PERFORM marketing_assert('marketing.view'); END IF;
 IF p_mode='config' THEN
  RETURN jsonb_build_object('enabled',(SELECT enabled FROM marketing_feature_settings),'client_version',1,
   'permissions',(SELECT jsonb_object_agg(code,marketing_can(code)) FROM permissions WHERE code LIKE 'marketing.%'),
   'categories',(SELECT jsonb_agg(to_jsonb(c)) FROM taxi_vehicle_categories c),
   'rates',(SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('amount',r.amount::text)) FROM taxi_incentive_rates r),
   'rewards',(SELECT jsonb_agg(to_jsonb(r) ORDER BY cards_required,code) FROM driver_reward_catalog r WHERE is_active));
 ELSIF p_mode='lookup' THEN
  IF length(search)<3 THEN RETURN jsonb_build_object('drivers','[]'::jsonb,'vehicles','[]'::jsonb); END IF;
  RETURN jsonb_build_object(
   'drivers',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM (SELECT id,name,phone,phone_normalized,is_active,version FROM marketing_drivers
     WHERE phone_normalized=CASE WHEN regexp_replace(search,'[^0-9]','','g') ~ '^(91|0)?[6-9][0-9]{9}$' THEN marketing_phone(search) ELSE '' END LIMIT 10) d),
   'vehicles',(SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('drivers',(
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'phone',d.phone,'is_active',d.is_active)),'[]')
       FROM marketing_driver_vehicles a JOIN marketing_drivers d ON d.id=a.driver_id WHERE a.vehicle_id=v.id AND a.effective_to IS NULL))),'[]')
     FROM (SELECT * FROM marketing_vehicles WHERE registration_normalized=marketing_registration(search) LIMIT 10) v));
 ELSIF p_mode='manual_events' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM (SELECT e.id,e.timestamp,e.vehicle_prefix
    FROM vehicle_counter_events e JOIN vehicle_origin_locations l ON l.id=e.location_id
    WHERE e.entered_by=auth.uid() AND e.taxi_visit_id IS NULL AND e.voided_at IS NULL AND e.increment=1
    AND e.business_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND e.timestamp>=now()-interval '30 minutes'
    AND lower(coalesce(e.vehicle_prefix,''))<>'bike' AND lower(l.name)<>'bike' ORDER BY e.timestamp DESC LIMIT 30) e);
 ELSIF p_mode='queue' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('eligible_amount',v.eligible_amount::text,'actual_amount',v.actual_amount::text,'confirmed_revenue',v.confirmed_revenue::text)),'[]') FROM (
   SELECT * FROM marketing_visit_summary WHERE voided_at IS NULL AND finalized_at IS NULL
    AND (created_by=auth.uid() OR marketing_can('marketing.manage')) ORDER BY arrived_at DESC LIMIT 100) v);
 ELSIF p_mode='visit' THEN
  IF NOT EXISTS(SELECT 1 FROM taxi_visits WHERE id=(p_filter->>'visit_id')::uuid AND
    (created_by=auth.uid() OR marketing_can('marketing.view') OR marketing_can('marketing.manage'))) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN (SELECT to_jsonb(v)||jsonb_build_object('eligible_amount',v.eligible_amount::text,'actual_amount',v.actual_amount::text,'confirmed_revenue',v.confirmed_revenue::text,
   'bills',(SELECT coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('last_amount',b.last_amount::text,'candidates',
    CASE WHEN marketing_can('marketing.reconcile') THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'invoice_no',s.invoice_no,'status',s.status,'net_sales',s.net_sales::text)),'[]')
      FROM sales_orders s WHERE s.business_date=b.business_date AND marketing_invoice(s.invoice_no)=b.invoice_key) ELSE '[]'::jsonb END) ORDER BY b.created_at),'[]') FROM taxi_visit_bills b WHERE b.visit_id=v.id),
   'punch',(SELECT to_jsonb(p) FROM driver_loyalty_punches p WHERE p.visit_id=v.id),
   'reconciliation_events',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('amount',e.amount::text) ORDER BY e.created_at DESC),'[]')
      FROM taxi_bill_reconciliation_events e JOIN taxi_visit_bills b ON b.id=e.bill_id WHERE b.visit_id=v.id))
   FROM marketing_visit_summary v WHERE v.id=(p_filter->>'visit_id')::uuid);
 END IF;
 IF NOT(marketing_can('marketing.view') OR marketing_can('marketing.manage')) THEN PERFORM marketing_assert('marketing.view'); END IF;
 IF p_mode='directory' THEN
   WITH matches AS (
    SELECT d.* FROM marketing_drivers d WHERE search='' OR d.name ILIKE '%'||search||'%' OR d.phone_normalized ILIKE '%'||search||'%'
      OR EXISTS(SELECT 1 FROM marketing_driver_vehicles a JOIN marketing_vehicles v ON v.id=a.vehicle_id WHERE a.driver_id=d.id
      AND (v.registration_normalized LIKE '%'||marketing_registration(search)||'%' OR v.make_model ILIKE '%'||search||'%' OR v.category_code ILIKE '%'||search||'%'))
   ) SELECT jsonb_build_object('total',(SELECT count(*) FROM matches),'page',page,'page_size',25,
    'drivers',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT * FROM matches ORDER BY lower(name),id LIMIT 25 OFFSET (page-1)*25) x)) INTO result;
 ELSIF p_mode='profile' THEN
   SELECT to_jsonb(d)||jsonb_build_object(
    'vehicles',(SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('effective_to',a.effective_to,'association_id',a.id)),'[]') FROM marketing_driver_vehicles a JOIN marketing_vehicles v ON v.id=a.vehicle_id WHERE a.driver_id=d.id),
    'cards',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM marketing_card_state(d.id) c),
    'punches',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC),'[]') FROM driver_loyalty_punches p JOIN driver_loyalty_cards c ON c.id=p.card_id WHERE c.driver_id=d.id),
    'openings',(SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]') FROM driver_loyalty_openings o WHERE o.driver_id=d.id),
    'redemptions',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('cards',(SELECT jsonb_agg(card_id) FROM driver_reward_redemption_cards WHERE redemption_id=r.id)) ORDER BY r.created_at DESC),'[]') FROM driver_reward_redemptions r WHERE r.driver_id=d.id),
    'visit_total',(SELECT count(*) FROM taxi_visits WHERE driver_id=d.id),
    'visits',(SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('eligible_amount',v.eligible_amount::text,'actual_amount',v.actual_amount::text,'confirmed_revenue',v.confirmed_revenue::text)),'[]')
      FROM (SELECT * FROM marketing_visit_summary WHERE driver_id=d.id ORDER BY arrived_at DESC,id LIMIT 25 OFFSET (page-1)*25) v),
    'history',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC),'[]') FROM marketing_audit_events e WHERE e.entity_id=d.id OR e.entity_id IN(SELECT id FROM taxi_visits WHERE driver_id=d.id))
   ) INTO result FROM marketing_drivers d WHERE d.id=driver;
 ELSIF p_mode='report' THEN
   IF first_day>last_day OR last_day-first_day>3660 THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
   WITH visits AS (SELECT * FROM marketing_visit_summary WHERE business_date BETWEEN first_day AND last_day AND voided_at IS NULL),
   active AS (SELECT DISTINCT driver_id FROM visits),
   balances AS (SELECT c.* FROM active a CROSS JOIN LATERAL marketing_card_state(a.driver_id) c),
   totals AS (SELECT count(*) AS visits,count(*) FILTER(WHERE brought_guests) AS guest_visits,
     coalesce(sum(guests),0) AS guests,coalesce(sum(confirmed_revenue),0) AS revenue,coalesce(sum(eligible_amount),0) AS eligible,
     coalesce(sum(actual_amount),0) AS given,count(*) FILTER(WHERE reconciliation_state='AWAITING_BILLS') AS awaiting,
     count(*) FILTER(WHERE reconciliation_state='FULLY_RECONCILED') AS complete,
     sum(confirmed_revenue) FILTER(WHERE reconciliation_state='FULLY_RECONCILED') AS complete_revenue FROM visits)
   SELECT jsonb_build_object('from',first_day,'to',last_day,'date_basis','ARRIVAL','generated_at',now(),
    'visits',t.visits,'guest_visits',t.guest_visits,'guests',t.guests,'revenue',t.revenue::text,'eligible',t.eligible::text,'given',t.given::text,
    'awaiting',t.awaiting,'complete',t.complete,'avg_guests',round(t.guests::numeric/nullif(t.visits,0),2)::text,
    'avg_billing',round(t.revenue/nullif(t.guest_visits,0),2)::text,'avg_incentive',round(t.given/nullif(t.guests,0),2)::text,
    'avg_complete_billing',round(t.complete_revenue/nullif(t.complete,0),2)::text,
    'active_drivers',(SELECT count(*) FROM active),'saved_cards_current',(SELECT count(*) FROM balances WHERE credits=12 AND NOT redeemed),
    'redeemable_cards_current',(SELECT count(*) FROM active a CROSS JOIN LATERAL marketing_card_state(a.driver_id) c JOIN marketing_drivers d ON d.id=a.driver_id WHERE c.credits=12 AND c.held=0 AND NOT c.redeemed AND NOT d.redemption_exception),
    'completed_in_period',(SELECT count(*) FROM marketing_audit_events WHERE action='CARD_COMPLETED' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN first_day AND last_day),
    'redemptions_in_period',(SELECT count(*) FROM driver_reward_redemptions WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN first_day AND last_day),
    'exceptions',(SELECT coalesce(jsonb_object_agg(state,n),'{}') FROM (SELECT b.state,count(*) n FROM taxi_visit_bills b JOIN visits v ON v.id=b.visit_id WHERE b.voided_at IS NULL AND b.state<>'MATCHED' GROUP BY b.state) e),
    'rows',(SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('eligible_amount',v.eligible_amount::text,'actual_amount',v.actual_amount::text,'confirmed_revenue',v.confirmed_revenue::text)),'[]') FROM (SELECT * FROM visits ORDER BY arrived_at DESC,id LIMIT 100 OFFSET (page-1)*100) v)) INTO result FROM totals t;
 ELSE RAISE EXCEPTION 'INVALID_READ_MODE'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION marketing_read(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marketing_read(text,jsonb) TO authenticated;

CREATE FUNCTION public.operating_metrics(p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT(marketing_can('dashboard.view') OR marketing_can('operations.daily') OR marketing_can('reports.view')) THEN PERFORM marketing_assert('reports.view'); END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>3660 THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
 WITH coverage AS (SELECT (p_to-p_from+1) AS expected,count(DISTINCT business_date) AS imported
  FROM sales_import_batches WHERE report_type='ORDERS_MASTER' AND business_date BETWEEN p_from AND p_to),
 dining AS (SELECT coalesce(sum(net_sales),0) AS net,count(*) AS bills,coalesce(sum(covers_pax),0) AS covers FROM sales_orders
  WHERE business_date BETWEEN p_from AND p_to AND status='Success'
   AND lower(trim(order_type)) IN ('dine in','dine-in','dinein') AND upper(trim(coalesce(area,''))) NOT IN ('LANCHO','PARCEL')
   AND coalesce(payment_type,'') NOT ILIKE '%lancho%'),
 vehicles AS (SELECT coalesce(sum(e.increment) FILTER(WHERE e.vehicle_category IN ('CAR_5','CAR_7','CAR') OR
    (e.vehicle_category IS NULL AND lower(coalesce(e.vehicle_prefix,''))<>'bike' AND lower(coalesce(l.name,''))<>'bike')),0) AS cars,
    coalesce(sum(e.increment) FILTER(WHERE e.vehicle_category='BIKE' OR (e.vehicle_category IS NULL AND (lower(coalesce(e.vehicle_prefix,''))='bike' OR lower(coalesce(l.name,''))='bike'))),0) AS bikes,
    coalesce(sum(e.increment) FILTER(WHERE e.vehicle_category='TRAVELLER'),0) AS travellers,
    coalesce(sum(e.increment) FILTER(WHERE e.vehicle_category='BUS'),0) AS buses
  FROM vehicle_counter_events e LEFT JOIN vehicle_origin_locations l ON l.id=e.location_id
  WHERE e.business_date BETWEEN p_from AND p_to AND e.voided_at IS NULL),
 completeness AS (SELECT *,imported=expected AND p_to<(now() AT TIME ZONE 'Asia/Kolkata')::date AS complete FROM coverage)
 SELECT jsonb_build_object('from',p_from,'to',p_to,'expected_days',c.expected,'imported_days',c.imported,'complete',c.complete,
  'live',p_to>=(now() AT TIME ZONE 'Asia/Kolkata')::date,'net_sales',d.net::text,'bills',d.bills,'covers',d.covers,
  'cars',v.cars,'bikes',v.bikes,'travellers',v.travellers,'buses',v.buses,
  'spend_per_cover',CASE WHEN c.complete THEN round(d.net/nullif(d.covers,0),2)::text END,
  'spend_per_bill',CASE WHEN c.complete THEN round(d.net/nullif(d.bills,0),2)::text END,
  'covers_per_bill',CASE WHEN c.complete THEN round(d.covers::numeric/nullif(d.bills,0),2)::text END,
  'covers_per_car',CASE WHEN c.complete THEN round(d.covers::numeric/nullif(v.cars,0),2)::text END,
  'spend_per_car',CASE WHEN c.complete THEN round(d.net/nullif(v.cars,0),2)::text END)
 INTO result FROM completeness c CROSS JOIN dining d CROSS JOIN vehicles v;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION operating_metrics(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION operating_metrics(date,date) TO authenticated;
