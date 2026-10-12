"use client";

export default function StorageError({ reset }: { reset: () => void }) {
  return <section role="alert" className="workspace-page mx-auto max-w-5xl rounded-lg border border-line bg-white p-5">
    <h1 className="text-lg font-semibold text-ink">Storage could not be loaded</h1>
    <p className="mt-2 text-sm text-muted">Check that you are signed in to the correct workspace, then retry. No purchase or file change was made by loading this page.</p>
    <button type="button" onClick={reset} className="mt-4 min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Retry</button>
  </section>;
}
