import { type FormEvent, useEffect, useRef, useState } from "react";
import { AuthShell, cardCls } from "../components/AuthShell";
import { Button } from "../components/ui/Button";
import { ErrorBanner } from "../components/ui/StateViews";
import { TextField } from "../components/ui/TextField";
import { useClient } from "../context";
import { useAuth } from "../context/auth";
import { useCopy } from "../lib/clipboard";
import { setupErrorMessage } from "../lib/errors";

type Step = "credentials" | "apikey";

const MIN_PASSWORD = 8;

export function SetupPage() {
  const { completeSetup, finishSetup } = useAuth();
  const client = useClient();

  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Asked for only when the server has WEBFROST_SETUP_TOKEN set.
  const [tokenRequired, setTokenRequired] = useState(false);
  const [setupToken, setSetupToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const { state: copyState, copy } = useCopy();

  useEffect(() => {
    client
      .getSetupStatus()
      .then((status) => setTokenRequired(status.setupTokenRequired === true))
      .catch(() => {});
  }, [client]);

  async function handleSubmitCredentials(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setLoading(true);
    try {
      const key = await completeSetup(username, password, tokenRequired ? setupToken : undefined);
      setApiKey(key);
      setStep("apikey");
    } catch (err) {
      setError(setupErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      subtitle={step === "credentials" ? "Set up your admin account" : "Save your API key"}
    >
      {step === "credentials" && (
        <form onSubmit={handleSubmitCredentials} className={cardCls}>
          {error && <ErrorBanner message={error} />}

          {tokenRequired && (
            <TextField
              label="Setup token"
              type="password"
              autoComplete="off"
              required
              autoFocus
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              hint="The value of WEBFROST_SETUP_TOKEN on the server."
            />
          )}
          <TextField
            label="Username"
            type="text"
            autoComplete="username"
            required
            autoFocus={!tokenRequired}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            hint={`At least ${MIN_PASSWORD} characters.`}
          />
          <TextField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
          <Button type="submit" size="lg" disabled={loading} className="mt-1">
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>
      )}

      {step === "apikey" && (
        <div className={cardCls}>
          <p
            role="alert"
            className="m-0 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-ui-base text-warning"
          >
            This API key will not be shown again. Copy it now and store it securely.
          </p>

          <TextField
            label="API key"
            type="text"
            readOnly
            inputRef={keyRef}
            value={apiKey}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono"
          />
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => copy(apiKey, keyRef.current)}>
              {copyState === "copied" ? "Copied!" : "Copy key"}
            </Button>
            <span role="status" className="text-ui-sm text-mid">
              {copyState === "copied" && "Copied to the clipboard."}
              {copyState === "failed" &&
                "Could not copy automatically. The key is selected: press Ctrl+C (or Cmd+C)."}
            </span>
          </div>

          <Button size="lg" onClick={() => finishSetup(username)} className="mt-1">
            Go to dashboard
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
