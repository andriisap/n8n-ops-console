// Page title with a line of context under it.
export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="mb-1 text-xl font-semibold tracking-tight">{title}</h2>
      {children && <div className="flex flex-wrap items-center gap-x-2.5 text-muted">{children}</div>}
    </div>
  );
}
