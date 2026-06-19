type AuthMessageProps = {
  error?: string;
  message?: string;
};

export function AuthMessage({ error, message }: AuthMessageProps) {
  if (!error && !message) {
    return null;
  }

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        error ? "border-red-200 bg-red-50 text-red-700" : "border-vaeroex-accent/50 bg-vaeroex-soft text-vaeroex-blue"
      }`}
    >
      {error || message}
    </div>
  );
}
