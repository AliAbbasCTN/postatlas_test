import { Fragment } from "react";
import { ratingText } from "@/lib/review";

// Read-only stars. The meaning is carried by the text label, never by colour alone.
export function StarsDisplay({ rating, count, showText = true, className = "" }: { rating: number | null; count?: number; showText?: boolean; className?: string }) {
  const filled = rating == null ? 0 : Math.round(rating);
  const label = count == null ? (rating == null ? "No rating" : `${rating.toFixed(1)} out of 5 stars`) : ratingText(rating, count);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span role="img" aria-label={label} className="text-base leading-none tracking-tight">
        {[1, 2, 3, 4, 5].map((n) => <span key={n} aria-hidden className={n <= filled ? "text-amber" : "text-linestrong"}>★</span>)}
      </span>
      {showText && <span className="text-sm text-inksoft">{label}</span>}
    </span>
  );
}

// A plain radio group (works without JavaScript and with a keyboard: arrow keys move between stars). The DOM order is
// 5..1 inside a reversed flex row, so "this star and every star before it" light up with CSS alone.
export function StarInput({ name = "rating", legend = "Your rating" }: { name?: string; legend?: string }) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="inline-flex flex-row-reverse justify-end gap-1 rounded-md p-1 focus-within:outline focus-within:outline-2 focus-within:outline-navy">
        {[5, 4, 3, 2, 1].map((n) => (
          <Fragment key={n}>
            <input id={`${name}-${n}`} type="radio" name={name} value={n} required className="peer sr-only" />
            <label htmlFor={`${name}-${n}`} className="cursor-pointer text-3xl leading-none text-linestrong transition-colors hover:text-amber peer-checked:text-amber [&:hover~label]:text-amber">
              <span aria-hidden>★</span><span className="sr-only">{n} star{n === 1 ? "" : "s"}</span>
            </label>
          </Fragment>
        ))}
      </div>
    </fieldset>
  );
}
