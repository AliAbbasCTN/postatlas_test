export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-[40vh] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-inksoft">
        <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-navy" />
        Loading…
      </div>
    </div>
  );
}
