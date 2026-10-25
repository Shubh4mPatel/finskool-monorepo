import { Check } from "lucide-react";

/** A horizontal progress stepper: finished steps are checked, the track between them fills as you advance. */
export default function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-start justify-center" aria-label="Progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = current > n;
        const active = current === n;
        return (
          <li key={label} className="flex items-start" aria-current={active ? "step" : undefined}>
            <div className="flex w-24 flex-col items-center text-center sm:w-32">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 ${
                  done
                    ? "bg-primary text-white"
                    : active
                    ? "bg-primary text-white ring-4 ring-primary/15 shadow-glow"
                    : "bg-divider text-subtle"
                }`}
              >
                {done ? <Check size={15} className="animate-fade" /> : n}
              </div>
              <span
                className={`mt-2 hidden text-xs font-semibold transition-colors duration-300 sm:block ${
                  active || done ? "text-primary" : "text-subtle"
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="mt-4 h-1 w-10 overflow-hidden rounded-full bg-divider sm:w-16" aria-hidden>
                <div
                  className={`h-full rounded-full bg-gradient-to-r from-lime to-accent transition-all duration-500 ease-out ${
                    done ? "w-full" : "w-0"
                  }`}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
