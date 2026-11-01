"use client";

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="flex min-w-0 flex-1 justify-end">{children}</span>
    </label>
  );
}

export function Range({ label, value, min, max, step = 1, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; fmt?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="block py-1 text-xs">
      <span className="flex justify-between text-muted"><span>{label}</span><span className="tabular-nums">{fmt ? fmt(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--accent)]" />
    </label>
  );
}

export function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <Row label={label}>
      <input type="number" value={Math.round(value * 100) / 100} step={step}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }}
        className="w-20 border border-line bg-transparent px-1.5 py-0.5 text-right tabular-nums" />
    </Row>
  );
}

export function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted">{value}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-6 cursor-pointer border border-line bg-transparent p-0" />
      </span>
    </Row>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="max-w-full border border-line bg-transparent px-1.5 py-0.5">
        {options.map((o) => <option key={o.value} value={o.value} className="text-black">{o.label}</option>)}
      </select>
    </Row>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label}><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" /></Row>
  );
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Collapsed-by-default group for the detailed settings, so the main panels stay short. */
export function Advanced({ title = "Advanced", children }: { title?: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted marker:hidden [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden className="transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="pb-1">{children}</div>
    </details>
  );
}

export const inputCls = "w-full border border-line bg-transparent px-1.5 py-0.5";
