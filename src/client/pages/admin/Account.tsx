import { PageHeader } from '../../components/ui';
import { AccountPanel } from '../auth/Account';

export default function AdminAccount() {
  return (
    <>
      <PageHeader title="My account" />
      <AccountPanel />
    </>
  );
}
