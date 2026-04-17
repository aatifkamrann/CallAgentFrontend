ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS transcript TEXT;