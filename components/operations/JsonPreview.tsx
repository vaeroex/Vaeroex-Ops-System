import type { Json } from "@/lib/supabase/types";

export function JsonPreview({ value }: { value: Json }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
