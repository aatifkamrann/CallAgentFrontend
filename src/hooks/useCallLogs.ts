import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { fetchAllCallLogs, insertCallLog, subscribeToCallLogs, CallLogRecord } from '@/services/db';

export type DbCallLog = CallLogRecord;

export function useCallLogs() {
  const [callLogs, setCallLogs] = useState<DbCallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetch = async () => {
    try {
      const { data, error } = await fetchAllCallLogs();
      if (error) {
        toast({ title: 'Error loading call logs', description: error.message, variant: 'destructive' });
      } else {
        setCallLogs(data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
    const unsub = subscribeToCallLogs(fetch);
    return unsub;
  }, []);

  const addCallLog = async (log: Omit<DbCallLog, 'id' | 'created_at'>) => {
    const { error } = await insertCallLog(log);
    if (error) {
      toast({ title: 'Error adding call log', description: error.message, variant: 'destructive' });
      return false;
    }
    // Avoid waiting for poll tick; refresh immediately after successful insert.
    await fetch();
    return true;
  };

  return { callLogs, loading, addCallLog, refetch: fetch };
}
