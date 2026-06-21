import { Check, X, Loader2, Pause, Clock } from "lucide-react";

const config: Record<
  string,
  {
    bg: string;
    text: string;
    icon: typeof Check;
    dot?: boolean;
    spin?: boolean;
  }
> = {
  pending: {
    bg: "bg-neutral-100",
    text: "text-neutral-500",
    icon: Clock,
  },
  running: {
    bg: "bg-blue-50",
    text: "text-blue-600",
    icon: Loader2,
    spin: true,
  },
  succeeded: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    icon: Check,
  },
  failed: {
    bg: "bg-red-50",
    text: "text-red-600",
    icon: X,
  },
  stopped: {
    bg: "bg-amber-50",
    text: "text-amber-600",
    icon: Pause,
  },
};

export function StatusBadge({ status }: { status: string }) {
  const c = config[status] ?? config.pending;
  const Icon = c.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium ${c.bg} ${c.text}`}
    >
      <Icon
        size={11}
        strokeWidth={2.5}
        className={c.spin ? "animate-spin" : ""}
      />
      {status}
    </span>
  );
}
