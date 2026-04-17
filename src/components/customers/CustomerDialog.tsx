import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CustomerFormData, FinalResponse } from '@/hooks/useCustomers';
import { DbCustomer } from '@/hooks/useCustomers';

interface CustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CustomerFormData) => Promise<boolean>;
  customer?: DbCustomer | null;
}

export function CustomerDialog({ open, onOpenChange, onSubmit, customer }: CustomerDialogProps) {
  const normalizeDpd = (value: number) => {
    if (!Number.isFinite(value)) return 1;
    return Math.min(30, Math.max(1, Math.round(value)));
  };

  const [form, setForm] = useState<CustomerFormData>({
    name: '', phone: '', balance: 0, dpd: 1, follow_up_count: 0, ptp_status: null, ptp_date: null, final_response: null, gender: 'male',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) {
      setForm({
        name: customer.name,
        phone: customer.phone,
        balance: Number(customer.balance),
        dpd: normalizeDpd(customer.dpd),
        follow_up_count: customer.follow_up_count,
        ptp_status: customer.ptp_status,
        ptp_date: customer.ptp_date ? customer.ptp_date.split('T')[0] : null,
        final_response: customer.final_response || null,
        gender: (customer as any).gender === 'female' ? 'female' : 'male',
      });
    } else {
      setForm({ name: '', phone: '+92', balance: 0, dpd: 1, follow_up_count: 0, ptp_status: null, ptp_date: null, final_response: null, gender: 'male' });
    }
  }, [customer, open]);

  const isDpdValid = Number.isFinite(form.dpd) && form.dpd >= 1 && form.dpd <= 30;
  const isBalanceValid = Number.isFinite(form.balance) && form.balance >= 0;

  const handleSubmit = async () => {
    if (!form.name || !form.phone || !isDpdValid || !isBalanceValid) return;
    setSaving(true);
    const success = await onSubmit({ ...form, dpd: normalizeDpd(form.dpd) });
    setSaving(false);
    if (success) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{customer ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+923001234567" />
            </div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Select value={form.gender || 'male'} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">👨 Male</SelectItem>
                  <SelectItem value="female">👩 Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Balance (PKR)</Label>
              <Input type="number" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: Number(e.target.value) }))} />
              <p className={`text-[10px] ${isBalanceValid ? 'text-muted-foreground' : 'text-destructive'}`}>Negative balance is invalid</p>
            </div>
            <div className="space-y-1.5">
              <Label>DPD</Label>
              <Input type="number" min={1} max={30} value={form.dpd} onChange={e => setForm(f => ({ ...f, dpd: Number(e.target.value) }))} />
              <p className={`text-[10px] ${isDpdValid ? 'text-muted-foreground' : 'text-destructive'}`}>Allowed range: 1 to 30</p>
            </div>
            <div className="space-y-1.5">
              <Label>Follow-ups</Label>
              <Input type="number" value={form.follow_up_count} onChange={e => setForm(f => ({ ...f, follow_up_count: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>PTP Status</Label>
              <Select value={form.ptp_status || 'none'} onValueChange={v => setForm(f => ({ ...f, ptp_status: v === 'none' ? null : v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="kept">Kept</SelectItem>
                  <SelectItem value="broken">Broken</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>PTP Date</Label>
              <Input type="date" value={form.ptp_date || ''} onChange={e => setForm(f => ({ ...f, ptp_date: e.target.value || null }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Final Response</Label>
            <Select value={form.final_response || 'none'} onValueChange={v => setForm(f => ({ ...f, final_response: v === 'none' ? null : v as FinalResponse }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="ptp_secured">✅ PTP Secured (Gave New Date)</SelectItem>
                <SelectItem value="no_answer">📵 No Answer</SelectItem>
                <SelectItem value="non_customer_pickup">👤 Non-Customer Pickup</SelectItem>
                <SelectItem value="switched_off">📴 Switched Off</SelectItem>
                <SelectItem value="negotiation_barrier">🚫 Negotiation Barrier</SelectItem>
                <SelectItem value="refused">❌ Refused to Pay</SelectItem>
                <SelectItem value="callback_requested">📞 Callback Requested</SelectItem>
                <SelectItem value="partial_payment">💰 Partial Payment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !form.name || !form.phone || !isDpdValid || !isBalanceValid}>
            {saving ? 'Saving...' : customer ? 'Update' : 'Add Customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
