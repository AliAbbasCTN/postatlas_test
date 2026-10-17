export default function Loading() {
  return (
    <div className="max-w-[1000px] mx-auto px-6 py-16" role="status" aria-label="Loading your report">
      <div className="h-8 w-2/3 rounded bg-mist animate-pulse mb-6" />
      <div className="grid sm:grid-cols-3 gap-4 mb-8">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-lg bg-mist animate-pulse" />)}</div>
      <div className="h-48 rounded-lg bg-mist animate-pulse" />
    </div>
  );
}
