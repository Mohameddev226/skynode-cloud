import { Cloud } from 'lucide-react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Branding */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow">
          <Cloud className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          SkyNode Cloud
        </h1>
        <p className="text-sm text-muted-foreground">
          Deploy &amp; scale with confidence
        </p>
      </div>

      {/* Auth card */}
      <div className="w-full max-w-sm">{children}</div>

      {/* Footer */}
      <p className="mt-8 text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} SkyNode Cloud. All rights reserved.
      </p>
    </div>
  );
}
