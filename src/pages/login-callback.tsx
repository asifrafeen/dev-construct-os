import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Blocks, Loader2, ShieldAlert } from 'lucide-react';
import { finishLogin } from '@/features/auth/sso';
import { ME_KEY } from '@/features/users/hooks';
import { Button } from '@/components/ui/button';

/** Mounted at the registered redirectUri. This is where the session cookie gets set. */
export function LoginCallbackPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const ran = useRef(false); // React 19 runs effects twice in dev — the code is single-use

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    finishLogin(window.location.search)
      .then(async () => {
        // The cookie now exists; re-run /iam/me so the app picks up the new session.
        await qc.invalidateQueries({ queryKey: ME_KEY });
        navigate('/', { replace: true });
      })
      .catch(setError);
  }, [navigate, qc]);

  if (error != null) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-5 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">Sign-in didn&rsquo;t complete</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
          </div>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Blocks className="h-6 w-6 text-primary" />
      </span>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Completing sign-in…
      </p>
    </div>
  );
}
