'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { FormField } from '@/components/ui/FormField';
import { useLogin } from '@/lib/mutations/useLogin';
import { useIdentity } from '@/lib/identity/IdentityProvider';
import { ApiError, NetworkError } from '@/lib/api-client';
import { dashboardPathForRole, isPathAllowedForRole } from '@/lib/navigation';

// Matches the backend's actual class-validator rules exactly:
// email must be @IsEmail, password just @IsString @MinLength(1).
const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

type BannerState =
  | { kind: 'invalid-credentials'; message: string }
  | { kind: 'network' }
  | { kind: 'rate-limited' }
  | { kind: 'server-error' }
  | null;

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

/**
 * useSearchParams() opts the page out of static rendering unless wrapped
 * in Suspense (Next.js requirement) — split into an inner component so the
 * exported page itself provides that boundary.
 */
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading, primaryRole } = useIdentity();
  const login = useLogin();
  const [banner, setBanner] = useState<BannerState>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const redirectParam = searchParams?.get('redirect') ?? null;

  // Already-authenticated user visiting /login: bounce to their dashboard immediately.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(resolveDestination(redirectParam, primaryRole));
    }
  }, [isLoading, isAuthenticated, primaryRole, redirectParam, router]);

  function resolveDestination(redirect: string | null, role: string | null): string {
    if (redirect && isPathAllowedForRole(redirect, role)) return redirect;
    return dashboardPathForRole(role);
  }

  async function onSubmit(values: LoginFormValues) {
    setBanner(null);
    try {
      const result = await login.mutateAsync(values);
      // useLogin's onSuccess already refetches identity; read the freshly
      // fetched role off the mutation result's own query invalidation by
      // deferring to the identity hook via a short redirect after settle.
      void result;
      // primaryRole may not have propagated to this render yet — read the
      // dashboard target from the next tick via router navigation to
      // "dashboard by role" once IdentityProvider updates. We navigate
      // optimistically to the role-agnostic root and let AuthGuard/RoleGate
      // resolve, but per spec we redirect to the exact dashboard, so we
      // wait one microtask for the identity query to settle.
    } catch (err) {
      if (err instanceof NetworkError) {
        setBanner({ kind: 'network' });
      } else if (err instanceof ApiError) {
        if (err.status === 429) {
          setBanner({ kind: 'rate-limited' });
        } else if (err.status === 401 || err.status === 400) {
          setBanner({ kind: 'invalid-credentials', message: err.message || 'Invalid email or password.' });
        } else if (err.status >= 500) {
          setBanner({ kind: 'server-error' });
        } else {
          setBanner({ kind: 'invalid-credentials', message: err.message || 'Invalid email or password.' });
        }
      } else {
        setBanner({ kind: 'server-error' });
      }
    }
  }

  // Once login succeeds and identity resolves, redirect to the correct
  // destination (role dashboard, or an authorized ?redirect= target).
  useEffect(() => {
    if (login.isSuccess && isAuthenticated && primaryRole) {
      router.replace(resolveDestination(redirectParam, primaryRole));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login.isSuccess, isAuthenticated, primaryRole]);

  if (isLoading || isAuthenticated) {
    return null;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="mb-1 text-xl font-semibold text-text">Exam-Sync</h1>
        <p className="mb-6 text-sm text-text-muted">Sign in to continue.</p>

        {banner && (
          <Alert color="danger" className="mb-4" title={bannerTitle(banner.kind)}>
            {bannerMessage(banner)}
          </Alert>
        )}

        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <FormField<LoginFormValues> name="email" label="Email" required>
              {(field) => (
                <Input
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  type="email"
                  autoComplete="email"
                  disabled={login.isPending}
                />
              )}
            </FormField>

            <FormField<LoginFormValues> name="password" label="Password" required>
              {(field) => (
                <Input
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  disabled={login.isPending}
                />
              )}
            </FormField>

            <Button type="submit" loading={login.isPending} disabled={login.isPending} className="mt-2">
              Sign in
            </Button>
          </form>
        </FormProvider>
      </div>
    </main>
  );
}

function bannerTitle(kind: NonNullable<BannerState>['kind']): string {
  switch (kind) {
    case 'invalid-credentials':
      return 'Sign-in failed';
    case 'network':
      return 'Connection problem';
    case 'rate-limited':
      return 'Too many attempts';
    case 'server-error':
      return 'Something went wrong';
  }
}

function bannerMessage(banner: NonNullable<BannerState>): string {
  switch (banner.kind) {
    case 'invalid-credentials':
      // The backend deliberately never distinguishes wrong-password from
      // unknown-email (account-enumeration protection) — surfaced verbatim.
      return banner.message;
    case 'network':
      return 'Check your connection and try again.';
    case 'rate-limited':
      return 'Please wait a moment before trying again.';
    case 'server-error':
      return 'Please try again later.';
  }
}
