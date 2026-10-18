import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { users } from './api';
import { useActiveOrg } from '@/features/orgs/hooks';
import { useRoles } from '@/features/roles/hooks';
import { Modal, Field } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ErrorNote, Input } from '@/components/ui/misc';
import { Checkbox, splitList } from '@/components/ui/form';
import { JsonView } from '@/components/ui/layout';

/**
 * Add and/or remove roles for many users at once, in the active organization.
 *
 * Unlike `users/access` (which replaces one user's whole role set), this is additive and
 * subtractive. Preview first — it reports how many users the change would touch; the real
 * call is queued (202) and lands asynchronously, so the list may lag a moment.
 */
export function BulkRolesModal({ selectedIds, onClose }: { selectedIds: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { activeOrgId } = useActiveOrg();
  const roles = useRoles({ pageSize: 100 });
  const [add, setAdd] = useState('');
  const [remove, setRemove] = useState('');
  const [everyone, setEveryone] = useState(selectedIds.length === 0);

  const body = () => ({
    organizationId: activeOrgId,
    addRoles: splitList(add),
    removeRoles: splitList(remove),
    target: everyone ? { filter: activeOrgId ? { organizationIds: [activeOrgId] } : {} } : { userIds: selectedIds },
  });
  const preview = useMutation({ mutationFn: () => users.bulkRoles(body(), true) });
  const apply = useMutation({
    mutationFn: () => users.bulkRoles(body(), false),
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: ['iam', 'users'] }), 1500),
  });
  const slugs = (roles.data?.data ?? []).map((r) => r.slug).filter(Boolean) as string[];
  const nothing = !splitList(add).length && !splitList(remove).length;

  return (
    <Modal
      open
      onClose={onClose}
      title="Bulk role change"
      description="POST /iam/v4/iam/users/roles/bulk/preview → /roles/bulk"
      footer={
        <>
          <Button variant="outline" disabled={nothing || preview.isPending} onClick={() => preview.mutate()}>
            Preview
          </Button>
          <Button disabled={nothing || apply.isPending} onClick={() => apply.mutate()}>
            Apply
          </Button>
        </>
      }
    >
      <Checkbox
        label={`Everyone in the active organization`}
        hint={everyone ? 'Targets by filter.' : `Targets the ${selectedIds.length} selected user(s).`}
        checked={everyone}
        onChange={setEveryone}
      />
      <Field label="Add roles" hint={slugs.length ? `Available: ${slugs.join(', ')}` : undefined}>
        <Input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="role slugs, comma separated" />
      </Field>
      <Field label="Remove roles">
        <Input value={remove} onChange={(e) => setRemove(e.target.value)} placeholder="role slugs, comma separated" />
      </Field>
      {preview.isError && <ErrorNote error={preview.error} />}
      {preview.data && <JsonView value={preview.data} maxHeight="max-h-40" />}
      {apply.isError && <ErrorNote error={apply.error} />}
      {apply.isSuccess && <p className="text-sm text-emerald-600">Queued. The user list refreshes shortly.</p>}
    </Modal>
  );
}
