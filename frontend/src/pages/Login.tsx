import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { BrandMark } from "@/components/layout/Sidebar";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

const demoMode = import.meta.env.VITE_ENABLE_DEMO_BANNER !== "false";
const demoPassword = (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) ?? "";

const demoAccounts = [
  { label: "Project manager", email: "manager@demo.siteops.local" },
  { label: "Site engineer", email: "engineer1@demo.siteops.local" },
  { label: "Supervisor", email: "supervisor1@demo.siteops.local" },
  { label: "Storekeeper", email: "store@demo.siteops.local" },
];

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: demoMode ? "manager@demo.siteops.local" : "",
      password: demoMode ? demoPassword : "",
    },
  });

  const submit = async (values: FormValues) => {
    setError(null);
    try {
      await login(values.email.trim().toLowerCase(), values.password);
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const quickLogin = async (email: string) => {
    setValue("email", email);
    setValue("password", demoPassword);
    if (!demoPassword) return;
    setError(null);
    setBusy(email);
    try {
      await login(email, demoPassword);
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-950 px-12 py-10 lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-[0.14]" aria-hidden>
          <svg className="h-full w-full" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
            <defs>
              <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
                <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#8FD3C4" strokeWidth="0.6" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            <path d="M-40 610 L210 430 L430 470 L640 300" fill="none" stroke="#B4DBD1" strokeWidth="1.4" />
            <path d="M-40 660 L210 480 L430 520 L640 350" fill="none" stroke="#B4DBD1" strokeWidth="1.4" opacity="0.5" />
            <circle cx="210" cy="430" r="5" fill="#B4DBD1" />
            <circle cx="430" cy="470" r="5" fill="#B4DBD1" />
          </svg>
        </div>
        <div className="relative z-10">
          <BrandMark />
        </div>
        <div className="relative z-10 mt-auto max-w-lg pb-10">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-brand-200">
            <Sparkles className="h-3 w-3" /> Field operations, auditable
          </p>
          <h1 className="text-[38px] font-semibold leading-[1.1] tracking-tight text-white">
            Site records that hold up
            <br />
            when someone asks why.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/55">
            Daily reports, stock ledgers, issues, invoices and drawing Q&amp;A in one workspace — with AI that is
            grounded, labelled, and never allowed to approve anything on its own.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              "Every number computed from the database, not the model",
              "Human review before anything is saved, approved or verified",
              "Project isolation enforced on every endpoint",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[13px] text-white/70">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 flex items-center gap-2 border-t border-white/10 pt-4 text-[11px] text-white/35">
          <ShieldCheck className="h-3.5 w-3.5" />
          Portfolio demo · fictional project data · Argon2 + rotating refresh tokens
        </div>
      </aside>

      <section className="flex flex-col px-5 py-8 sm:px-10 lg:px-16">
        <div className="mb-10 flex items-center justify-between lg:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
                <path d="M4 18V9.5L12 4l8 5.5V18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8.5 18v-4.5h7V18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
                <path d="M3 18h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-sm font-semibold tracking-tight">SiteOps AI</span>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Demo</span>
        </div>

        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center">
          <div className="animate-fade-up">
            <h2 className="text-[26px] font-semibold tracking-tight text-ink">Sign in</h2>
            <p className="mt-1.5 text-sm text-ink-muted">Use your project account to continue.</p>

            <form className="mt-7 space-y-4" onSubmit={handleSubmit(submit)} noValidate>
              <Field label="Work email" htmlFor="email" error={errors.email?.message}>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@company.com"
                  aria-invalid={Boolean(errors.email)}
                  {...register("email")}
                />
              </Field>
              <Field label="Password" htmlFor="password" error={errors.password?.message}>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    className="pr-11"
                    aria-invalid={Boolean(errors.password)}
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-ink-faint transition-colors hover:text-ink"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              {error ? (
                <div className="rounded-lg border border-[#F6CFC9] bg-[#FDECEA] px-3 py-2 text-sm text-danger" role="alert">
                  {error}
                </div>
              ) : null}

              <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
                Sign in <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            {demoMode ? (
              <div className="mt-8 rounded-xl border border-line bg-white/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Demo accounts</p>
                  {demoPassword ? (
                    <span className="font-mono text-[10px] text-ink-faint">pwd · {demoPassword}</span>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {demoAccounts.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => quickLogin(account.email)}
                      className="flex items-center justify-between rounded-lg border border-line bg-white px-2.5 py-2 text-left text-[11px] font-medium text-ink-muted transition-colors hover:border-brand-300 hover:text-brand-800 disabled:opacity-60"
                    >
                      {account.label}
                      {busy === account.email ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
                  Fictional demo data. Registration is open in this environment; roles are enforced server-side.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
