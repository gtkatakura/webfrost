import { type FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthShell, cardCls } from "../components/AuthShell";
import { Button } from "../components/ui/Button";
import { ErrorBanner } from "../components/ui/StateViews";
import { TextField } from "../components/ui/TextField";
import { useAuth } from "../context/auth";
import { loginErrorMessage } from "../lib/errors";
import { returnToPath } from "../lib/returnTo";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate(returnToPath(location.state), { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell subtitle="Sign in to continue">
      <form onSubmit={handleSubmit} className={cardCls}>
        {error && <ErrorBanner message={error} />}
        <TextField
          label="Username"
          type="text"
          autoComplete="username"
          required
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="admin"
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        <Button type="submit" size="lg" disabled={loading} className="mt-1">
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
