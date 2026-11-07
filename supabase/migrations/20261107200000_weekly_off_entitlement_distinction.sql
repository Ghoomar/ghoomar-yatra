-- Migration: 20261107200000_weekly_off_entitlement_distinction.sql
-- Description: Allow allotted_weekly_off in employee_salary_periods to be NULL
-- so that an unconfirmed monthly entitlement is clearly distinguishable from an intentionally entered zero (0).

ALTER TABLE public.employee_salary_periods 
  ALTER COLUMN allotted_weekly_off DROP NOT NULL,
  ALTER COLUMN allotted_weekly_off DROP DEFAULT;

COMMENT ON COLUMN public.employee_salary_periods.allotted_weekly_off IS 
  'Authoritative manager-entered weekly-off entitlement for this salary month. NULL indicates pending manager entry; 0 or greater indicates confirmed count.';
