export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="max-w-3xl">
      <div className="h-8 w-1/3 rounded bg-paperdim animate-pulse mb-6" />
      <div className="h-24 rounded-lg bg-paperdim animate-pulse mb-4" />
      <div className="h-24 rounded-lg bg-paperdim animate-pulse" />
    </div>
  );
}
