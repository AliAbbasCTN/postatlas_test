export default function Loading() {
  return (
    <div className="max-w-[1000px]">
      <div className="h-8 w-48 bg-paperdim rounded mb-8 animate-pulse" />
      <div className="h-40 bg-paperdim rounded mb-6 animate-pulse" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-paperdim rounded animate-pulse" />)}
      </div>
    </div>
  );
}
