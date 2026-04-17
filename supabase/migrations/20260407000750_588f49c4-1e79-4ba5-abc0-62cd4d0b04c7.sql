ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS scheduled_retry_at TIMESTAMPTZ;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS retry_reason TEXT;