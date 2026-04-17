import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Upload, Phone, Plus, Pencil, Trash2, FileDown, RefreshCw, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PriorityBadge } from '@/components/dashboard/PriorityBadge';
import { ToneBadge, AgentBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCustomers, DbCustomer } from '@/hooks/useCustomers';
import { CustomerDialog } from '@/components/customers/CustomerDialog';
import { AgentType, ToneMode, getOutcomeDisplay } from '@/types/voice-agent';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { isRecordingPredictionPending } from '@/lib/utils';

export default function Customers() {
  const navigate = useNavigate();
  const { customers, loading, addCustomer, updateCustomer, deleteCustomer, importCustomers, refetch } = useCustomers();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'priority' | 'dpd' | 'balance'>('priority');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<DbCustomer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DbCustomer | null>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const parseDelimitedLine = (line: string, delimiter: string) => {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === delimiter && !inQuotes) {
        out.push(current);
        current = '';
        continue;
      }

      current += ch;
    }

    out.push(current);
    return out;
  };

  const normalizePhone = (value: string) => {
    let raw = String(value || '').trim();
    if (!raw) return '';

    // Common spreadsheet wrapper format: ="+923..."
    raw = raw.replace(/^="?/, '').replace(/"?$/, '').trim();

    // Convert scientific notation to integer string where possible.
    if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(raw)) {
      const n = Number(raw);
      if (Number.isFinite(n)) raw = n.toFixed(0);
    }

    const hasLeadingPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';

    if (hasLeadingPlus) return `+${digits}`;
    if (digits.startsWith('92') && digits.length === 12) return `+${digits}`;
    if (digits.startsWith('0') && digits.length === 11) return `+92${digits.slice(1)}`;
    if (digits.length === 10) return `+92${digits}`;
    return `+${digits}`;
  };

  const normalizeHeader = (header: string) => {
    const cleaned = header.trim().toLowerCase().replace(/^\uFEFF/, '').replace(/^['"=]+|['"]+$/g, '');
    if (cleaned === 'follow_up' || cleaned === 'followup_count' || cleaned === 'followup') return 'follow_up_count';
    return cleaned;
  };

  const clampDpd = (value: number) => {
    if (!Number.isFinite(value)) return 1;
    return Math.min(30, Math.max(1, Math.round(value)));
  };

  const detectDelimiter = (headerLine: string) => {
    const candidates: Array<'\t' | ',' | ';'> = ['\t', ',', ';'];
    let best: '\t' | ',' | ';' = ',';
    let bestCount = -1;
    for (const d of candidates) {
      const count = parseDelimitedLine(headerLine, d).length;
      if (count > bestCount) {
        best = d;
        bestCount = count;
      }
    }
    return best;
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = String(file.name || '').toLowerCase();
    if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
      toast({
        title: 'Unsupported format',
        description: 'Please upload CSV/TSV/TXT. If using Excel, save the file as CSV first.',
        variant: 'destructive',
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setImporting(true);
    setImportStatus(`Reading file: ${file.name}`);
    try {
      const text = await file.text();
      setImportStatus('Parsing CSV headers...');
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        setImportStatus('Import failed: CSV has no data rows');
        toast({ title: 'Import Failed', description: 'CSV appears empty or has no data rows', variant: 'destructive' });
        return;
      }
      // Auto-detect delimiter: tab/comma/semicolon
      const delimiter = detectDelimiter(lines[0]);
      const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeHeader);
      const nameIdx = headers.indexOf('name');
      const phoneIdx = headers.indexOf('phone');
      const balanceIdx = headers.indexOf('balance');
      const dpdIdx = headers.indexOf('dpd');
      const followUpIdx = headers.indexOf('follow_up_count');
      const ptpStatusIdx = headers.indexOf('ptp_status');
      const ptpDateIdx = headers.indexOf('ptp_date');
      const finalIdx = headers.indexOf('final_response');
      const genderIdx = headers.indexOf('gender');

      if (nameIdx === -1 || phoneIdx === -1) {
        setImportStatus('Import failed: required columns missing');
        toast({ title: 'Invalid CSV', description: 'CSV must have "name" and "phone" columns', variant: 'destructive' });
        return;
      }

      const rows = [] as Array<{
        name: string;
        phone: string;
        balance: number;
        dpd: number;
        follow_up_count: number;
        ptp_status?: 'pending' | 'kept' | 'broken' | null;
        ptp_date?: string | null;
        final_response?: any;
        gender?: string;
      }>;

      let skippedInvalid = 0;
      let skippedInvalidDpd = 0;
      let skippedNegativeBalance = 0;
      setImportStatus('Validating and normalizing rows...');
      for (let i = 1; i < lines.length; i++) {
        const cols = parseDelimitedLine(lines[i], delimiter).map(c => c.trim().replace(/^["'=]+|["']+$/g, ''));
        if (!cols[nameIdx] || !cols[phoneIdx]) continue;
        const rawPhone = normalizePhone(cols[phoneIdx]);
        const numericLen = rawPhone.replace(/\D/g, '').length;
        if (numericLen < 10) {
          skippedInvalid += 1;
          continue;
        }
        const parsedDpd = dpdIdx >= 0 ? Number(cols[dpdIdx]) : 1;
        if (!Number.isFinite(parsedDpd) || parsedDpd < 1 || parsedDpd > 30) {
          skippedInvalid += 1;
          skippedInvalidDpd += 1;
          continue;
        }
        const parsedBalance = balanceIdx >= 0 ? Number(cols[balanceIdx]) : 0;
        if (!Number.isFinite(parsedBalance) || parsedBalance < 0) {
          skippedInvalid += 1;
          skippedNegativeBalance += 1;
          continue;
        }
        rows.push({
          name: cols[nameIdx],
          phone: rawPhone,
          balance: parsedBalance,
          dpd: clampDpd(parsedDpd),
          follow_up_count: followUpIdx >= 0 ? Number(cols[followUpIdx]) || 0 : 0,
          ptp_status: ptpStatusIdx >= 0 ? (cols[ptpStatusIdx] || undefined) as any : undefined,
          ptp_date: ptpDateIdx >= 0 ? cols[ptpDateIdx] || undefined : undefined,
          final_response: finalIdx >= 0 ? (cols[finalIdx] || undefined) as any : undefined,
          gender: genderIdx >= 0 ? (cols[genderIdx] || 'unknown') : 'unknown',
        });
      }

      if (rows.length === 0) {
        setImportStatus('Import failed: no valid rows found');
        toast({ title: 'Import Failed', description: 'No valid customer rows found in CSV', variant: 'destructive' });
        return;
      }

      setImportStatus(`Importing ${rows.length} customer(s) to database...`);
      const result = await importCustomers(rows);
      if (result) {
        setImportStatus(`Import completed: ${result.imported} imported${result.skipped ? `, ${result.skipped} skipped` : ''}`);
      } else {
        setImportStatus('Import failed while saving to database');
      }
      if (skippedInvalid > 0) {
        toast({
          title: 'Some rows skipped',
          description: `${skippedInvalid} row(s) were invalid and skipped${skippedInvalidDpd ? ` (${skippedInvalidDpd} due to DPD not in 1-30)` : ''}${skippedNegativeBalance ? `${skippedInvalidDpd ? ',' : ' ('} ${skippedNegativeBalance} due to negative balance${skippedInvalidDpd ? '' : ')'}` : ''}.`,
        });
      }
    } catch (err: any) {
      setImportStatus(`Import failed: ${err?.message || 'Unknown error'}`);
      toast({ title: 'Import Failed', description: err.message, variant: 'destructive' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const excelSafePhone = (value: string) => {
      const raw = String(value || '').trim().replace(/"/g, '');
      if (!raw) return '';
      // Excel keeps phone as text and avoids scientific notation.
      return `="${raw}"`;
    };

    const header = ['name', 'phone', 'balance', 'dpd', 'follow_up_count', 'ptp_status', 'ptp_date', 'final_response', 'gender'];
    const rows = [
      ['Faraz Ahmed', excelSafePhone('+923101234567'), '55000', '10', '0', '', '', '', 'male'],
      ['Atif Hussain', excelSafePhone('+923112345678'), '130000', '30', '2', 'pending', '2026-04-12', '', 'male'],
      ['Sadia Parveen', excelSafePhone('+923121234567'), '40000', '5', '0', '', '', '', 'female'],
      ['Rizwan Ali', excelSafePhone('+923131234567'), '90000', '20', '1', '', '', 'callback_requested', 'male'],
      ['Nida Fatima', excelSafePhone('+923141234567'), '175000', '28', '4', 'broken', '', 'refused', 'female'],
      ['Kamran Shah', excelSafePhone('+923151234567'), '65000', '15', '0', '', '', '', 'male'],
      ['Hina Qadir', excelSafePhone('+923161234567'), '100000', '28', '2', '', '', 'negotiation_barrier', 'female'],
      ['Tariq Mehmood', excelSafePhone('+923171234567'), '50000', '12', '1', 'pending', '2026-04-15', 'ptp_secured', 'male'],
      ['Filza Noor', excelSafePhone('+923181234567'), '150000', '25', '3', 'pending', '2026-04-11', 'ptp_secured', 'female'],
      ['Aqsa Bibi', excelSafePhone('+923191234567'), '30000', '8', '0', '', '', 'non_customer_pickup', 'female'],
    ];
    const encode = (v: string) => {
      const escaped = String(v).replace(/"/g, '""');
      return `"${escaped}"`;
    };
    const csv = [header.map(encode).join(','), ...rows.map(r => r.map(encode).join(','))].join('\n');
    // Add BOM so Excel detects UTF-8 properly
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'customers_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllCustomers = () => {
    const excelSafePhone = (value: string) => {
      const raw = String(value || '').trim().replace(/"/g, '');
      if (!raw) return '';
      return `="${raw}"`;
    };

    const header = [
      'id', 'name', 'phone', 'balance', 'dpd', 'follow_up_count', 'priority_score',
      'assigned_agent', 'assigned_tone', 'ptp_status', 'ptp_date', 'final_response',
      'last_call_date', 'scheduled_retry_at', 'retry_reason', 'gender', 'created_at', 'updated_at',
    ];
    const encode = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = customers.map((c) => [
      c.id,
      c.name,
      excelSafePhone(c.phone),
      c.balance,
      c.dpd,
      c.follow_up_count,
      c.priority_score,
      c.assigned_agent,
      c.assigned_tone,
      c.ptp_status || '',
      c.ptp_date || '',
      c.final_response || '',
      c.last_call_date || '',
      c.scheduled_retry_at || '',
      c.retry_reason || '',
      (c as any).gender || 'unknown',
      c.created_at || '',
      c.updated_at || '',
    ]);
    const csv = [header.map(encode).join(','), ...rows.map((r) => r.map(encode).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = customers
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))
    .sort((a, b) => {
      if (sortBy === 'priority') return Number(b.priority_score) - Number(a.priority_score);
      if (sortBy === 'dpd') return b.dpd - a.dpd;
      return Number(b.balance) - Number(a.balance);
    });

  const handleEdit = (customer: DbCustomer) => {
    setEditingCustomer(customer);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingCustomer(null);
    setDialogOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Customers</h1>
            <p className="text-sm text-muted-foreground mt-1">{customers.length} accounts in collection queue</p>
            {importStatus && (
              <p className="text-xs text-muted-foreground mt-1">
                {importing ? 'Processing: ' : 'Last import: '} {importStatus}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleCsvImport} />
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2">
              <FileDown className="w-4 h-4" /> Template
            </Button>
            <Button variant="outline" size="sm" onClick={exportAllCustomers} className="gap-2" disabled={customers.length === 0}>
              <FileDown className="w-4 h-4" /> Export CSV
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              <Upload className="w-4 h-4" /> {importing ? 'Importing...' : 'Import CSV'}
            </Button>
            <Button className="gap-2" onClick={handleAdd}>
              <Plus className="w-4 h-4" /> Add Customer
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by name or phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-1">
            {(['priority', 'dpd', 'balance'] as const).map(s => (
              <Button key={s} size="sm" variant={sortBy === s ? 'default' : 'secondary'} onClick={() => setSortBy(s)}>
                {s === 'priority' ? 'Priority' : s === 'dpd' ? 'DPD' : 'Balance'}
              </Button>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading customers...</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Customer</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Balance</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">DPD</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Follow-ups</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Priority</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Agent / Tone</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Last Outcome</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">PTP</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Last Call</th>
                  <th className="text-left px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Next Retry</th>
                  <th className="text-right px-3 py-3 text-[10px] font-medium text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(customer => {
                  const outcomeDisplay = customer.final_response ? getOutcomeDisplay(customer.final_response) : null;
                  const ptpDate = customer.ptp_date ? new Date(customer.ptp_date) : null;
                  const lastCall = customer.last_call_date ? new Date(customer.last_call_date) : null;
                  const nextRetry = customer.scheduled_retry_at ? new Date(customer.scheduled_retry_at) : null;
                  const now = new Date();
                  const isOverdue = nextRetry && nextRetry <= now;
                  const recordingPredictionPending = isRecordingPredictionPending(customer.retry_reason);
                  
                  return (
                    <tr key={customer.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-3">
                        <p className="text-sm font-medium text-card-foreground">{customer.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{customer.phone}</p>
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {(customer as any).gender === 'female' ? '👩' : (customer as any).gender === 'male' ? '👨' : '❓'} {(customer as any).gender || 'unknown'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold text-card-foreground">PKR {Number(customer.balance).toLocaleString()}</td>
                      <td className="px-3 py-3">
                        <span className={`text-sm font-bold ${customer.dpd >= 60 ? 'text-destructive' : customer.dpd >= 30 ? 'text-amber-500' : 'text-foreground'}`}>
                          {customer.dpd}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-card-foreground">{customer.follow_up_count}</td>
                      <td className="px-3 py-3"><PriorityBadge score={Number(customer.priority_score)} /></td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <AgentBadge agent={customer.assigned_agent as AgentType} />
                          <ToneBadge tone={customer.assigned_tone as ToneMode} />
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {outcomeDisplay ? (
                          <div className="flex flex-col gap-1">
                            <span className={`text-xs font-medium ${outcomeDisplay.color}`}>{outcomeDisplay.icon} {outcomeDisplay.label}</span>
                            {recordingPredictionPending && (
                              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Recording analysis pending...
                              </span>
                            )}
                          </div>
                        ) : recordingPredictionPending ? (
                          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Recording analysis pending...
                          </span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-0.5">
                          <span className="text-xs">
                            {customer.ptp_status === 'kept' ? '✅ Kept' : customer.ptp_status === 'broken' ? '❌ Broken' : customer.ptp_status === 'pending' && ptpDate ? '📅 PTP Scheduled' : customer.ptp_status === 'pending' ? '⏳ PTP Pending' : '—'}
                          </span>
                          {ptpDate && (
                            <p className="text-[10px] text-primary font-medium">
                              📅 PTP Date: {ptpDate.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}
                            </p>
                          )}
                          {recordingPredictionPending && !ptpDate && (
                            <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Awaiting recording PTP data...
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {lastCall ? (
                          <div>
                            <p className="text-xs text-foreground">{lastCall.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}</p>
                            <p className="text-[10px] text-muted-foreground">{lastCall.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                        ) : <span className="text-xs text-muted-foreground">Never</span>}
                      </td>
                      <td className="px-3 py-3">
                        {nextRetry ? (
                          <div>
                            <p className={`text-xs font-medium ${isOverdue ? 'text-destructive' : 'text-primary'}`}>
                              {isOverdue ? '🔴 Overdue' : '🔵 Scheduled'}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {nextRetry.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })} {nextRetry.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            {customer.retry_reason && (
                              <p className="text-[9px] text-muted-foreground/70 truncate max-w-[120px]">{customer.retry_reason}</p>
                            )}
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(customer)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(customer)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => navigate('/calls', { state: { selectedCustomerId: customer.id, triggerCall: true } })}>
                            <Phone className="w-3 h-3" /> Call
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customer={editingCustomer}
        onSubmit={async (data) => {
          if (editingCustomer) {
            return updateCustomer(editingCustomer.id, data);
          }
          return addCustomer(data);
        }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteTarget?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (deleteTarget) {
                await deleteCustomer(deleteTarget.id);
                setDeleteTarget(null);
              }
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
