import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, User, Briefcase, ShieldCheck } from "lucide-react";
import { api } from "@/lib/quota/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tokenwise" },
      { name: "description", content: "Sign in as a user, manager, or admin to see AI token usage, cost, and quota intelligence." },
      { property: "og:title", content: "Tokenwise" },
      { property: "og:description", content: "Predict quota exhaustion and automatically redistribute unused AI tokens." },
    ],
  }),
  component: Landing,
});

type Role = "user" | "manager" | "admin";

interface RoleConfig {
  roleTag: string;
  title: string;
  placeholder: string;
  hint: string;
  pattern: RegExp;
  loginFn: (id: string) => Promise<{ ok: boolean }>;
  getRedirect: (id: string) => { to: string; params: { id: string } };
}

const ROLE_CONFIGS: Record<Role, RoleConfig> = {
  user: {
    roleTag: "USER",
    title: "User Portal",
    placeholder: "U0001",
    hint: "Demo IDs: U0001 – U0055",
    pattern: /^U\d{4}$/,
    loginFn: (id) => api.userLogin(id),
    getRedirect: (id) => ({ to: "/user/$id", params: { id } }),
  },
  manager: {
    roleTag: "MANAGER",
    title: "Manager Portal",
    placeholder: "M001",
    hint: "Demo IDs: M001 – M005",
    pattern: /^M\d{3}$/,
    loginFn: (id) => api.managerLogin(id),
    getRedirect: (id) => ({ to: "/manager/$id", params: { id } }),
  },
  admin: {
    roleTag: "ADMIN",
    title: "Admin Portal",
    placeholder: "A0001",
    hint: "Demo IDs: A0001 – A0003",
    pattern: /^A\d{4}$/,
    loginFn: (id) => api.adminLogin(id),
    getRedirect: (id) => ({ to: "/admin/$id", params: { id } }),
  },
};

function Landing() {
  const nav = useNavigate();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [id, setId] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSelectRole = (role: Role) => {
    setSelectedRole(role);
    setVerifying(true);
    setId("");
    setErr("");
    setTimeout(() => {
      setVerifying(false);
    }, 900);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;
    const config = ROLE_CONFIGS[selectedRole];
    const v = id.trim().toUpperCase();

    if (!v) {
      setErr(`Please enter your ${config.roleTag} ID.`);
      return;
    }

    if (!config.pattern.test(v)) {
      setErr(`Invalid ID format for ${config.title}. Expected format: ${config.placeholder}`);
      return;
    }

    setSubmitting(true);
    setErr("");
    try {
      const res = await config.loginFn(v);
      if (res && res.ok) {
        nav(config.getRedirect(v));
      } else {
        setErr(`Access denied. ID "${v}" does not belong to the ${config.title}.`);
      }
    } catch {
      setErr(`Unable to verify ID "${v}". Please try again.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-12 bg-background">
      {/* Left Column: Form & Portal Access */}
      <div className="lg:col-span-7 flex flex-col justify-center px-6 py-12 lg:px-16 xl:px-20">
        <div className="max-w-xl mx-auto w-full">
          <div className="mb-2 font-mono text-xs uppercase tracking-widest text-primary font-semibold">Tokenwise</div>
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight text-foreground">
            AI Token Utilization &amp; Quota Intelligence Dashboard
          </h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            AI governance platform empowering teams with real-time quota tracking, proactive consumption insights, and automated cost optimization.
          </p>

          {/* State 1: Role Selection Buttons */}
          {!selectedRole && (
            <div className="mt-8">
              <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
                Select Portal Access
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <Button
                  variant="outline"
                  className="h-16 text-sm font-mono font-semibold tracking-wider hover:border-primary hover:bg-primary hover:text-primary-foreground transition-all flex items-center justify-center gap-2"
                  onClick={() => handleSelectRole("user")}
                >
                  <User className="h-4 w-4" />
                  USER
                </Button>
                <Button
                  variant="outline"
                  className="h-16 text-sm font-mono font-semibold tracking-wider hover:border-primary hover:bg-primary hover:text-primary-foreground transition-all flex items-center justify-center gap-2"
                  onClick={() => handleSelectRole("manager")}
                >
                  <Briefcase className="h-4 w-4" />
                  MANAGER
                </Button>
                <Button
                  variant="outline"
                  className="h-16 text-sm font-mono font-semibold tracking-wider hover:border-primary hover:bg-primary hover:text-primary-foreground transition-all flex items-center justify-center gap-2"
                  onClick={() => handleSelectRole("admin")}
                >
                  <ShieldCheck className="h-4 w-4" />
                  ADMIN
                </Button>
              </div>
            </div>
          )}

          {/* State 2: Short ~1 second "Verifying access..." animation */}
          {selectedRole && verifying && (
            <div className="mt-8 rounded-lg border bg-card p-8 text-center shadow-sm">
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <div className="font-mono text-sm font-semibold tracking-wide">Verifying access...</div>
                <div className="font-mono text-xs text-muted-foreground">
                  Loading {ROLE_CONFIGS[selectedRole].title} portal
                </div>
              </div>
            </div>
          )}

          {/* State 3: ID Input Form for selected role */}
          {selectedRole && !verifying && (
            <div className="mt-8 rounded-lg border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between border-b pb-3 mb-4">
                <div>
                  <div className="font-mono text-xs uppercase tracking-wider text-primary font-semibold">
                    {ROLE_CONFIGS[selectedRole].roleTag} PORTAL
                  </div>
                  <h2 className="text-xl font-bold">{ROLE_CONFIGS[selectedRole].title} Sign In</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRole(null);
                    setId("");
                    setErr("");
                  }}
                  className="text-xs font-mono text-muted-foreground hover:text-primary underline transition-colors"
                >
                  ← Change Role
                </button>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block font-mono text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Enter {ROLE_CONFIGS[selectedRole].roleTag} ID
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={id}
                      maxLength={5}
                      onChange={(e) => {
                        setId(e.target.value);
                        setErr("");
                      }}
                      placeholder={ROLE_CONFIGS[selectedRole].placeholder}
                      className="font-mono uppercase tracking-wider text-sm"
                      autoFocus
                    />
                    <Button type="submit" disabled={submitting} className="font-mono tracking-wide px-5 shrink-0">
                      {submitting ? "Verifying..." : "SIGN IN"}
                    </Button>
                  </div>
                </div>

                {err && (
                  <div className="rounded bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive font-mono">
                    {err}
                  </div>
                )}

                <div className="font-mono text-xs text-muted-foreground pt-1">
                  {ROLE_CONFIGS[selectedRole].hint}
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Blank Solid Red Corporate Pane */}
      <div className="hidden lg:block lg:col-span-5 bg-primary" />
    </main>
  );
}
