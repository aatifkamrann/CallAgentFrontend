-- =============================================
-- AI Voice Agent — Database Schema
-- Run this in your local Supabase SQL editor
-- =============================================

-- 1. Customers Table
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0,
  dpd INTEGER NOT NULL DEFAULT 0,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  priority_score NUMERIC NOT NULL DEFAULT 0,
  last_call_date TIMESTAMPTZ,
  ptp_date TIMESTAMPTZ,
  ptp_status TEXT,
  assigned_agent TEXT NOT NULL DEFAULT 'fresh_call',
  assigned_tone TEXT NOT NULL DEFAULT 'polite',
  final_response TEXT,
  scheduled_retry_at TIMESTAMPTZ,
  retry_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Call Logs Table
CREATE TABLE IF NOT EXISTS public.call_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  call_date_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  agent_type TEXT NOT NULL DEFAULT 'fresh_call',
  tone TEXT NOT NULL DEFAULT 'polite',
  outcome TEXT,
  ptp_date TIMESTAMPTZ,
  notes TEXT,
  recording_url TEXT,
  transcript TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Updated_at Trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 4. RLS Policies (open for POC — lock down for production)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- Customers: full access for anon (POC only)
CREATE POLICY "Allow public read customers" ON public.customers FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert customers" ON public.customers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update customers" ON public.customers FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow public delete customers" ON public.customers FOR DELETE TO anon USING (true);

-- Call Logs: full access for anon (POC only)
CREATE POLICY "Allow public read call_logs" ON public.call_logs FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert call_logs" ON public.call_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update call_logs" ON public.call_logs FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow public delete call_logs" ON public.call_logs FOR DELETE TO anon USING (true);

-- 5. Enable Realtime (optional)
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;
