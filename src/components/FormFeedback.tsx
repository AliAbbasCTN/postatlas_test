export function FormFeedback({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-6 border rounded-md p-4 text-sm ${error ? "border-redsig bg-[#F4E1DC] text-redsig" : "border-verdigris bg-[#E4EEEA] text-accenttext"}`}
    >
      {error || success}
    </div>
  );
}
