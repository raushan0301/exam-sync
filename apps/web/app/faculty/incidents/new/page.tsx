'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card } from '@/components/ui';
import { useCreateIncident } from '@/lib/mutations/useIncidentMutations';
import { mapError } from '@/lib/error-mapping';
import {
  IncidentForm,
  incidentFormSchema,
  defaultIncidentFormValues,
  toIncidentApiPayload,
  type IncidentFormValues,
} from '@/components/incident/IncidentForm';

export default function NewIncidentPage() {
  const router = useRouter();
  const createMutation = useCreateIncident();

  const form = useForm<IncidentFormValues>({
    resolver: zodResolver(incidentFormSchema),
    defaultValues: defaultIncidentFormValues(),
  });

  async function onSubmit(values: IncidentFormValues) {
    try {
      await createMutation.mutateAsync(toIncidentApiPayload(values));
      router.push('/faculty/incidents');
    } catch (err) {
      form.setError('root', { message: mapError(err).description });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Report Incident</h1>
        <p className="text-sm text-text-muted">
          Report an incident for an exam session you are invigilating.
        </p>
      </div>
      <Card>
        <IncidentForm
          form={form}
          submitLabel="Report Incident"
          submitting={createMutation.isPending}
          rootError={form.formState.errors.root?.message}
          onSubmit={onSubmit}
        />
      </Card>
    </div>
  );
}
