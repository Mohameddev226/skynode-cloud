'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import api from '@/lib/api';

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

const registerSchema = z
  .object({
    fullName: z
      .string()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name must be at most 100 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must include uppercase, lowercase, and a number'
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isGitHubLoading, setIsGitHubLoading] = useState(false);

  useEffect(() => {
    const err = searchParams.get('error');
    if (err) setError(decodeURIComponent(err));
  }, [searchParams]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  async function onSubmit(data: RegisterFormValues) {
    setError(null);

    const res = await api.post('/api/v1/auth/register', {
      fullName: data.fullName,
      email: data.email,
      password: data.password,
    });

    if (!res.success) {
      setError(res.error?.message ?? 'Registration failed. Please try again.');
      return;
    }

    router.push('/login?registered=true');
  }

  function handleGitHubSignup() {
    setIsGitHubLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    window.location.href = `${apiUrl}/api/v1/auth/github`;
  }

  return (
    <Card className="border-border/60 shadow-lg">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">Create an account</CardTitle>
        <CardDescription>
          Sign up with GitHub or enter your details to launch your project
        </CardDescription>
      </CardHeader>

      <div className="px-6 space-y-4">
        {/* GitHub OAuth Button */}
        <Button
          type="button"
          variant="outline"
          className="w-full flex items-center justify-center gap-2 border-border hover:bg-muted font-medium"
          onClick={handleGitHubSignup}
          disabled={isGitHubLoading || isSubmitting}
        >
          <GithubIcon className="h-4 w-4" />
          {isGitHubLoading ? 'Connecting to GitHub...' : 'Sign up with GitHub'}
        </Button>

        {/* Divider */}
        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">
              or continue with email
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4 pt-2">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Full Name */}
          <div className="space-y-2">
            <label
              htmlFor="fullName"
              className="text-sm font-medium leading-none text-foreground"
            >
              Full Name
            </label>
            <Input
              id="fullName"
              type="text"
              placeholder="John Doe"
              autoComplete="name"
              {...register('fullName')}
              aria-invalid={!!errors.fullName}
            />
            {errors.fullName && (
              <p className="text-xs text-destructive">
                {errors.fullName.message}
              </p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium leading-none text-foreground"
            >
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              {...register('email')}
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <p className="text-xs text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium leading-none text-foreground"
            >
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              {...register('password')}
              aria-invalid={!!errors.password}
            />
            {errors.password && (
              <p className="text-xs text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <label
              htmlFor="confirmPassword"
              className="text-sm font-medium leading-none text-foreground"
            >
              Confirm Password
            </label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              {...register('confirmPassword')}
              aria-invalid={!!errors.confirmPassword}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium"
            disabled={isSubmitting || isGitHubLoading}
            loading={isSubmitting}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Create account
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link
              href="/login"
              className="font-medium text-emerald-500 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}>
      <RegisterForm />
    </Suspense>
  );
}
