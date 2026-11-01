"use client";

import { useState } from "react";
import { ApiError, resolveLink, type ResolveResult } from "@/lib/api";

export default function PasteForm({ onResolved }: { onResolved: (r: ResolveResult) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onResolved(await resolveLink(value));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-xl">
      <label htmlFor="link" className="sr-only">
        Music link
      </label>
      <div className="flex border-b border-fg">
        <input
          id="link"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a Spotify, YouTube, SoundCloud… link"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-4 text-lg outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="px-4 text-sm font-medium text-accent disabled:text-muted"
        >
          {busy ? "Checking…" : "Create"}
        </button>
      </div>
      <p aria-live="polite" className="mt-3 min-h-5 text-sm text-accent">
        {error}
      </p>
    </form>
  );
}
