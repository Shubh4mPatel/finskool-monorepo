"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export default function PasswordInput({
  placeholder,
  value,
  onChange,
  onBlur,
  hasError,
}: {
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  hasError?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        className={`w-full rounded-xl border bg-white px-4 py-3 pr-10 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 ${
          hasError
            ? "border-red-400 focus:ring-red-200"
            : "border-divider focus:ring-accent/40"
        }`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle transition-colors hover:text-primary"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
