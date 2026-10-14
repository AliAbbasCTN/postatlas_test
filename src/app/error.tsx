"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="font-serif font-bold text-3xl mb-3">Something went wrong</h1>
        <p className="text-inksoft mb-6">We could not complete that. Nothing you did caused it. Please try again.{error.digest ? ` (Reference: ${error.digest})` : ""}</p>
        <button onClick={reset} className="btn-primary">Try again</button>
      </div>
    </div>
  );
}
