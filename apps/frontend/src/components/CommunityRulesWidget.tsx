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
      <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-primary">
        <ShieldCheck size={15} className="text-accent" />
        Community Rules
      </h3>

      <div className="mt-4 flex flex-col gap-3">
        {rules.map((rule) => (
          <div key={rule.number} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lime text-xs font-bold text-primary">
              {rule.number}
            </span>
            <p className="text-sm text-[#5a6a60]">{rule.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
