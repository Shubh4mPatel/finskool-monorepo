import { ShieldCheck } from "lucide-react";

const rules = [
  { number: "01", text: "Do not share calls outside this group" },
  { number: "02", text: "No personal contact requests" },
  { number: "03", text: "Follow admin SL strictly" },
  { number: "04", text: "Respect all members, no spam" },
];

export default function CommunityRulesWidget() {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card transition-shadow duration-300 hover:shadow-card-hover">
      <h3 className="flex items-center gap-2 font-display text-base font-bold text-primary">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lime/40 text-primary">
          <ShieldCheck size={14} />
        </span>
        Community Rules
      </h3>

      <div className="mt-4 flex flex-col gap-3">
        {rules.map((rule) => (
          <div key={rule.number} className="group flex items-start gap-3 rounded-xl -mx-2 px-2 py-1 transition-colors hover:bg-background">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-divider text-xs font-bold text-primary transition-colors duration-300 group-hover:bg-lime">
              {rule.number}
            </span>
            <p className="text-sm text-muted">{rule.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
