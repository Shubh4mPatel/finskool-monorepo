export default function ToggleSwitch({ on }: { on?: boolean }) {
  return (
    <div
      className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-300 ${
        on ? "bg-lime" : "bg-divider"
      }`}
    >
      <div
        className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </div>
  );
}
