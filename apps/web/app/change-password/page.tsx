'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { FormField } from '@/components/ui/FormField';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useChangePassword } from '@/lib/mutations/useChangePassword';
import { ApiError, NetworkError } from '@/lib/api-client';

// Mirrors the backend's ChangePasswordDto exactly (min 8 chars, at least
// one digit) — shown to the user as the hint text below, not just enforced
// silently after a failed submit.
const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password.'),
    new_password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .regex(/\d/, 'Password must contain at least one number.'),
    confirm_password: z.string().min(1, 'Re-enter your new password.'),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  });

type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

export default function ChangePasswordPage() {
  return (
    <AuthGuard>
      <ChangePasswordForm />
    </AuthGuard>
  );
}

function ChangePasswordForm() {
  const router = useRouter();
  const changePassword = useChangePassword();
  const [banner, setBanner] = useState<string | null>(null);

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  async function onSubmit(values: ChangePasswordFormValues) {
    setBanner(null);
    try {
      await changePassword.mutateAsync({
        current_password: values.current_password,
        new_password: values.new_password,
      });
      // The backend revoked this session's refresh token as part of the
      // change — send them back through a real login with the new password
      // rather than trying to keep the current one limping along.
      router.replace('/login?changed=1');
    } catch (err) {
      if (err instanceof NetworkError) {
        setBanner('Check your connection and try again.');
      } else if (err instanceof ApiError) {
        setBanner(err.message || 'Could not change your password.');
      } else {
        setBanner('Something went wrong. Please try again.');
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-text">Set a new password</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your account was created with a temporary password. Choose your own before continuing.
        </p>

        <FormProvider {...form}>
          <form className="mt-6 flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            {banner && <Alert color="danger">{banner}</Alert>}

            <FormField<ChangePasswordFormValues> name="current_password" label="Current (temporary) password" required>
              {(field) => (
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            </FormField>

            <FormField<ChangePasswordFormValues>
              name="new_password"
              label="New password"
              description="At least 8 characters, including at least one number."
              required
            >
              {(field) => (
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            </FormField>

            <FormField<ChangePasswordFormValues> name="confirm_password" label="Confirm new password" required>
              {(field) => (
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            </FormField>

            <Button type="submit" loading={changePassword.isPending} className="mt-2">
              Set password
            </Button>
          </form>
        </FormProvider>
      </div>
    </div>
  );
}
