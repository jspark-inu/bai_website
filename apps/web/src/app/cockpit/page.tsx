import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';

export default async function Page() {
  const member = await getCurrentMember();
  if (!member) redirect('/login');
  redirect('/');
}
