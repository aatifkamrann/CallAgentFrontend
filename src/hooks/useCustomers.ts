import { useState, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  bulkImportCustomers, fetchAllCustomers, insertCustomer, updateCustomerRecord,
  deleteCustomerRecord, subscribeToCustomers, CustomerRecord,
} from '@/services/db';
import { calculatePriority, autoAssignAgent, autoAssignTone } from '@/types/voice-agent';
import { loadSettings } from '@/config/agent-settings';

export type FinalResponse = 'ptp_secured' | 'no_answer' | 'non_customer_pickup' | 'switched_off' | 'negotiation_barrier' | 'refused' | 'callback_requested' | 'partial_payment' | 'busy' | 'payment_done' | 'abuse_detected' | null;

export type DbCustomer = CustomerRecord;

export interface CustomerFormData {
  name: string;
  phone: string;
  balance: number;
  dpd: number;
  follow_up_count: number;
  ptp_status?: 'pending' | 'kept' | 'broken' | null;
  ptp_date?: string | null;
  final_response?: FinalResponse;
  gender?: string;
}

export function useCustomers() {
  const [customers, setCustomers] = useState<DbCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const isFetchingRef = useRef(false);
  const pendingFetchRef = useRef(false);
  const pendingCreatesRef = useRef<Record<string, DbCustomer>>({});

  const sanitizeDpd = (value: number) => {
    if (!Number.isFinite(value)) return 1;
    return Math.min(30, Math.max(1, Math.round(value)));
  };

  const isBalanceValid = (value: number) => Number.isFinite(value) && value >= 0;

  const fetch = async (silent = false) => {
    if (isFetchingRef.current) {
      pendingFetchRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const { data, error } = await fetchAllCustomers();
      if (error) {
        toast({ title: 'Error loading customers', description: error.message, variant: 'destructive' });
      } else {
        const serverRows = data || [];
        const pendingRows = Object.values(pendingCreatesRef.current);
        const merged = [...serverRows];

        // Keep optimistic created rows visible until the backend confirms insertion.
        for (const pending of pendingRows) {
          const alreadyPresent = merged.some((row) =>
            row.id === pending.id ||
            (row.name === pending.name && row.phone === pending.phone)
          );
          if (!alreadyPresent) merged.push(pending);
        }

        setCustomers(merged.sort((a, b) => Number(b.priority_score) - Number(a.priority_score)));
      }
    } finally {
      isFetchingRef.current = false;
      if (!silent) setLoading(false);
      if (pendingFetchRef.current) {
        pendingFetchRef.current = false;
        void fetch(true);
      }
    }
  };

  useEffect(() => {
    void fetch();
    const settings = loadSettings();
    const pollMs = Math.max(1, Number(settings.schedulerPollMinutes) || 1) * 60 * 1000;
    const unsub = subscribeToCustomers(() => {
      void fetch(true);
    }, pollMs);
    return unsub;
  }, []);

  const addCustomer = async (data: CustomerFormData) => {
    if (!isBalanceValid(data.balance)) {
      toast({ title: 'Invalid balance', description: 'Negative balance is invalid', variant: 'destructive' });
      return false;
    }

    const safeDpd = sanitizeDpd(data.dpd);
    const now = new Date().toISOString();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const priority = calculatePriority(data.follow_up_count, data.balance / 1000, safeDpd);

    const optimistic: DbCustomer = {
      id: tempId,
      name: data.name,
      phone: data.phone,
      balance: data.balance,
      dpd: safeDpd,
      follow_up_count: data.follow_up_count,
      priority_score: priority,
      last_call_date: null,
      ptp_date: data.ptp_date || null,
      ptp_status: data.ptp_status || null,
      assigned_agent: autoAssignAgent({
        ptpStatus: (data.ptp_status || null) as any,
        dpd: safeDpd,
        followUpCount: data.follow_up_count,
        ptpDate: data.ptp_date || undefined,
      }),
      assigned_tone: autoAssignTone({
        ptpStatus: (data.ptp_status || null) as any,
        dpd: safeDpd,
        followUpCount: data.follow_up_count,
      }),
      final_response: data.final_response || null,
      scheduled_retry_at: null,
      retry_reason: null,
      gender: data.gender || 'unknown',
      created_at: now,
      updated_at: now,
    };

    // Instant UI update: show row immediately and close dialog without waiting for network.
    pendingCreatesRef.current[tempId] = optimistic;
    setCustomers((prev) => [optimistic, ...prev].sort((a, b) => Number(b.priority_score) - Number(a.priority_score)));

    const payload = {
      ...data,
      dpd: safeDpd,
      ptp_status: data.ptp_status || null,
      ptp_date: data.ptp_date || null,
      final_response: data.final_response || null,
    };

    void (async () => {
      const { data: created, error } = await insertCustomer(payload);
      if (error) {
        delete pendingCreatesRef.current[tempId];
        setCustomers((prev) => prev.filter((c) => c.id !== tempId));
        toast({ title: 'Error adding customer', description: error.message, variant: 'destructive' });
        return;
      }

      if (created?.id) {
        delete pendingCreatesRef.current[tempId];
        setCustomers((prev) => prev.map((c) => (c.id === tempId ? { ...c, id: created.id } : c)));
      } else {
        delete pendingCreatesRef.current[tempId];
      }

      toast({ title: 'Customer added successfully' });
      void fetch(true);
    })();

    return true;
  };

  const updateCustomer = async (id: string, data: CustomerFormData) => {
    if (!isBalanceValid(data.balance)) {
      toast({ title: 'Invalid balance', description: 'Negative balance is invalid', variant: 'destructive' });
      return false;
    }

    const safeDpd = sanitizeDpd(data.dpd);
    const previous = customers;
    setCustomers((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const priority = calculatePriority(data.follow_up_count, data.balance / 1000, safeDpd);
      return {
        ...c,
        ...data,
        dpd: safeDpd,
        priority_score: priority,
        updated_at: new Date().toISOString(),
      } as DbCustomer;
    }));

    const { error } = await updateCustomerRecord(id, {
      ...data,
      dpd: safeDpd,
      ptp_status: data.ptp_status || null,
      ptp_date: data.ptp_date || null,
      final_response: data.final_response || null,
    });
    if (error) {
      setCustomers(previous);
      toast({ title: 'Error updating customer', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: 'Customer updated successfully' });
    void fetch(true);
    return true;
  };

  const deleteCustomer = async (id: string) => {
    const previous = customers;
    setCustomers((prev) => prev.filter((c) => c.id !== id));

    const { error } = await deleteCustomerRecord(id);
    if (error) {
      setCustomers(previous);
      toast({ title: 'Error deleting customer', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: 'Customer deleted' });
    void fetch(true);
    return true;
  };

  const importCustomers = async (rows: CustomerFormData[]) => {
    const { data, error } = await bulkImportCustomers(rows.map((row) => ({
      ...row,
      dpd: sanitizeDpd(row.dpd),
      ptp_status: row.ptp_status || null,
      ptp_date: row.ptp_date || null,
      final_response: row.final_response || null,
    })));

    if (error) {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
      return null;
    }

    toast({
      title: 'Customers imported',
      description: `Imported ${data?.imported || 0}${data?.skipped ? ` • Skipped ${data.skipped}` : ''}${data?.invalidBalanceSkipped ? ` • Negative balance skipped ${data.invalidBalanceSkipped}` : ''}`,
    });
    void fetch(true);
    return data;
  };

  return { customers, loading, addCustomer, updateCustomer, deleteCustomer, importCustomers, refetch: fetch };
}
