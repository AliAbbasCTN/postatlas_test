export default function Loading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="flex items-center gap-3 text-inksoft text-sm">
        <span className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />
        Loading…
      </div>
    </div>
  );
}
