import { type InputHTMLAttributes, type Ref, useId } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** Label + input + optional hint, wired together with ids. */
export function TextField({ label, hint, inputRef, className = "", ...props }: TextFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-ui-base font-medium text-high">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`field ${className}`}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-ui-sm text-mid">
          {hint}
        </p>
      )}
    </div>
  );
}
