import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { UserPlus } from "lucide-react";

import { AuthLayout, FormError } from "./login";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/state/auth";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create account — FollowThrough" },
      {
        name: "description",
        content:
          "Create a FollowThrough account to upload training video and track basketball shot telemetry.",
      },
      { property: "og:title", content: "Create account — FollowThrough" },
      {
        property: "og:description",
        content: "Start tracking basketball shooting telemetry from your training sessions.",
      },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AuthLayout
      icon={UserPlus}
      greeting="Let's get started,"
      title="Create your account"
      subtitle="Set up a workspace for your training telemetry."
      footer={
        <>
          Already registered?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setPending(true);
          try {
            await register(name, email, password);
            navigate({ to: "/", replace: true });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Registration failed.");
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-email">Email</Label>
          <Input
            id="reg-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@team.com"
            className="field h-11"
          />
        </div>

        <PasswordField
          id="reg-password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          hint="Minimum 8 characters."
        />

        <FormError message={error} />

        <Button type="submit" className="h-11 w-full text-sm" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
