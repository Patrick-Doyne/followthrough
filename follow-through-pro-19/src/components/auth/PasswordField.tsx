import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A password box you can read back.
 *
 * <p>Both auth forms had a field you could type into and never check.
 * On a phone propped on a bench -- the device this product is built
 * around -- a mistyped password is the most likely reason a sign-in
 * fails, and the only recovery was to clear the field and start again.
 *
 * <p>The toggle is a real button: it is reachable by keyboard, it says
 * what it does rather than relying on the eye alone, and it reports
 * which state it is in. It sits inside the field's box, so the field
 * keeps its own focus ring instead of growing a second one.
 */
export function PasswordField({
  id,
  label = "Password",
  value,
  onChange,
  autoComplete,
  hint,
  minLength,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: "current-password" | "new-password";
  /** The rule, where there is one -- shown before it can be broken. */
  hint?: string | undefined;
  minLength?: number | undefined;
}) {
  const [shown, setShown] = useState(false);
  const hintId = useId();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? hintId : undefined}
          // Room for the toggle, so a long password does not run under it.
          className="field h-11 pe-11"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          // Not in the tab order: the field it belongs to is, and a
          // sighted keyboard user reaching it by Tab would be stepping
          // over a control they cannot see the purpose of mid-form. It
          // is still reachable, and still announced, on click and by
          // touch.
          tabIndex={-1}
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          {shown ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
