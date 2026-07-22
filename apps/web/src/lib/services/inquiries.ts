import { listInquiryRows } from '../db/repositories/inquiries.ts';

export function getInquiries() {
  const rows = listInquiryRows();
  const open = rows.filter((row) => row.status === 'open');
  const answered = rows.filter((row) => row.status === 'answered')
    .sort((a, b) => (b.answered_at ?? '').localeCompare(a.answered_at ?? ''));
  return { open, answered };
}