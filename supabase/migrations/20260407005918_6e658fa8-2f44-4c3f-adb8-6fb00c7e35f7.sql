
CREATE TABLE public.call_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  call_sid TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
  customer_name TEXT NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'fresh_call',
  tone TEXT NOT NULL DEFAULT 'polite',
  caller_name TEXT NOT NULL DEFAULT 'Iqra',
  voice TEXT NOT NULL DEFAULT 'Polly.Aditi',
  language TEXT NOT NULL DEFAULT 'ur-PK',
  balance NUMERIC NOT NULL DEFAULT 0,
  dpd INTEGER NOT NULL DEFAULT 0,
  ptp_status TEXT,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  final_response TEXT,
  ptp_date TEXT,
  notes TEXT,
  schedule_retry_hours INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.call_conversations DISABLE ROW LEVEL SECURITY;
