
-- Create customers table
CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0,
  dpd INTEGER NOT NULL DEFAULT 0,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  priority_score NUMERIC NOT NULL DEFAULT 0,
  last_call_date TIMESTAMP WITH TIME ZONE,
  ptp_date TIMESTAMP WITH TIME ZONE,
  ptp_status TEXT CHECK (ptp_status IN ('pending', 'kept', 'broken')),
  assigned_agent TEXT NOT NULL DEFAULT 'fresh_call',
  assigned_tone TEXT NOT NULL DEFAULT 'polite',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create call_logs table
CREATE TABLE public.call_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
  customer_name TEXT NOT NULL,
  call_date_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  duration INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  agent_type TEXT NOT NULL DEFAULT 'fresh_call',
  tone TEXT NOT NULL DEFAULT 'polite',
  outcome TEXT,
  ptp_date TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- Public access policies for POC (no auth required)
CREATE POLICY "Allow public read customers" ON public.customers FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert customers" ON public.customers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update customers" ON public.customers FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow public delete customers" ON public.customers FOR DELETE TO anon USING (true);

CREATE POLICY "Allow public read call_logs" ON public.call_logs FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert call_logs" ON public.call_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update call_logs" ON public.call_logs FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow public delete call_logs" ON public.call_logs FOR DELETE TO anon USING (true);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;
