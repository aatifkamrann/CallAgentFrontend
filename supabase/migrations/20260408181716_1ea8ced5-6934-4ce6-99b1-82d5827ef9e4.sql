-- Fix: gender column already exists, this is a no-op safety migration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'gender'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN gender TEXT NOT NULL DEFAULT 'unknown';
  END IF;
END $$;