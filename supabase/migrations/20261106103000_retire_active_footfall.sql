-- REVIEW REQUIRED. Preserve view column names/types for older clients, but stop
-- joining and calculating visitor metrics. Raw historic events remain untouched.
SET lock_timeout='3s';
CREATE OR REPLACE VIEW public.daily_target_progress AS
 SELECT d.business_date,d.net_sales AS revenue_achieved,
 EXTRACT(dow FROM d.business_date)::integer AS day_of_week,
 coalesce(ft.target_value,100000.00) AS daily_target,
 CASE WHEN coalesce(ft.target_value,100000.00)>0 THEN round(d.net_sales/coalesce(ft.target_value,100000.00)*100,1) ELSE 0::numeric END AS target_achievement_percent,
 coalesce(ft.target_value,100000.00)-d.net_sales AS remaining_revenue_to_target,
 NULL::bigint AS total_visitors,NULL::numeric AS revenue_per_visitor,
 d.last_updated_at AS revenue_updated_at,NULL::timestamptz AS last_visitor_at
 FROM daily_sales_summary d LEFT JOIN financial_targets ft ON ft.target_type='daily_weekday'
 AND ft.weekday=EXTRACT(dow FROM d.business_date)::integer AND ft.is_active=true;
