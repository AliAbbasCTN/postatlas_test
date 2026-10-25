export default function Loading() {
  return (
    <section className="py-16">
      <div className="max-w-[1180px] mx-auto px-6">
        <div className="h-4 w-32 bg-mist rounded mb-4 animate-pulse" />
        <div className="h-10 w-96 max-w-full bg-mist rounded mb-8 animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-mist rounded animate-pulse" />
          ))}
        </div>
      </div>
    </section>
  );
}
