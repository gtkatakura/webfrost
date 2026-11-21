import { type Ref, useId } from "react";

interface UrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  placeholder?: string;
  label?: string;
  /** Visually hide the label (the placeholder still shows the format). */
  hideLabel?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Text input for a web address. It is deliberately type="text": the browser's own type="url"
 * validation rejects "example.com", which is what people type. Callers run normalizeUrl().
 */
export function UrlField({
  value,
  onChange,
  error,
  placeholder = "https://example.com",
  label = "Web address",
  hideLabel = false,
  inputRef,
  className = "",
  autoFocus,
}: UrlFieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-ui-sm font-medium text-mid"}>
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        // biome-ignore lint/a11y/noAutofocus: opt-in for inputs that open on demand
        autoFocus={autoFocus}
        className="field font-mono"
      />
      {error && (
        <p id={errId} role="alert" className="m-0 text-ui-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
