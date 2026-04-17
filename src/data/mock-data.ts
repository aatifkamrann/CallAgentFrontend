import { Customer, CallLog, calculatePriority, autoAssignTone, autoAssignAgent } from '@/types/voice-agent';

const rawCustomers = [
  { name: 'Ahmed Raza Khan', phone: '+923001234567', balance: 15000, dpd: 5, followUpCount: 0, ptpStatus: undefined, ptpDate: undefined },
  { name: 'Fatima Bibi Malik', phone: '+923012345678', balance: 45000, dpd: 12, followUpCount: 2, ptpStatus: 'pending' as const, ptpDate: new Date(Date.now() + 86400000).toISOString() },
  { name: 'Muhammad Usman Ali', phone: '+923021234567', balance: 78000, dpd: 25, followUpCount: 4, ptpStatus: 'broken' as const, ptpDate: undefined },
  { name: 'Ayesha Siddiqui', phone: '+923031234567', balance: 23000, dpd: 8, followUpCount: 1, ptpStatus: undefined, ptpDate: undefined },
  { name: 'Bilal Hussain Shah', phone: '+923041234567', balance: 120000, dpd: 28, followUpCount: 5, ptpStatus: 'broken' as const, ptpDate: undefined },
  { name: 'Zainab Noor', phone: '+923051234567', balance: 8500, dpd: 3, followUpCount: 0, ptpStatus: undefined, ptpDate: undefined },
  { name: 'Imran Tariq Butt', phone: '+923061234567', balance: 56000, dpd: 18, followUpCount: 3, ptpStatus: 'pending' as const, ptpDate: new Date(Date.now() + 0).toISOString() },
  { name: 'Sana Javed Akhtar', phone: '+923071234567', balance: 34000, dpd: 14, followUpCount: 2, ptpStatus: 'kept' as const, ptpDate: undefined },
  { name: 'Hassan Abbas Qureshi', phone: '+923081234567', balance: 92000, dpd: 22, followUpCount: 3, ptpStatus: undefined, ptpDate: undefined },
  { name: 'Maryam Nawaz Sharif', phone: '+923091234567', balance: 17500, dpd: 7, followUpCount: 1, ptpStatus: undefined, ptpDate: undefined },
];

export const mockCustomers: Customer[] = rawCustomers.map((c, i) => ({
  id: `cust-${i + 1}`,
  ...c,
  priorityScore: calculatePriority(c.followUpCount, c.balance / 1000, c.dpd),
  assignedAgent: autoAssignAgent(c),
  assignedTone: autoAssignTone(c),
  lastCallDate: i > 2 ? new Date(Date.now() - Math.random() * 7 * 86400000).toISOString() : undefined,
}));

export const mockCallLogs: CallLog[] = [
  { id: 'call-1', customerId: 'cust-3', customerName: 'Muhammad Usman Ali', callDateTime: new Date(Date.now() - 3600000).toISOString(), duration: 185, status: 'completed', agentType: 'broken_promise', tone: 'assertive', outcome: 'Customer refused to commit. Escalating.', notes: 'Hostile response. Mentioned financial hardship.' },
  { id: 'call-2', customerId: 'cust-1', customerName: 'Ahmed Raza Khan', callDateTime: new Date(Date.now() - 7200000).toISOString(), duration: 120, status: 'completed', agentType: 'fresh_call', tone: 'polite', outcome: 'PTP secured for 3 days.', ptpDate: new Date(Date.now() + 3 * 86400000).toISOString() },
  { id: 'call-3', customerId: 'cust-5', customerName: 'Bilal Hussain Shah', callDateTime: new Date(Date.now() - 10800000).toISOString(), duration: 0, status: 'no_answer', agentType: 'no_answer', tone: 'polite', outcome: 'Auto-retry scheduled in 2 hours.' },
  { id: 'call-4', customerId: 'cust-2', customerName: 'Fatima Bibi Malik', callDateTime: new Date(Date.now() - 14400000).toISOString(), duration: 95, status: 'completed', agentType: 'ptp_reminder', tone: 'empathetic', outcome: 'Confirmed PTP for tomorrow.' },
  { id: 'call-5', customerId: 'cust-4', customerName: 'Ayesha Siddiqui', callDateTime: new Date(Date.now() - 18000000).toISOString(), duration: 45, status: 'voicemail', agentType: 'non_customer', tone: 'polite', outcome: 'Left voicemail. Rescheduled in 5 hours.' },
];
