import { cn } from "@/utilities/cn";
import { AlertCircleIcon } from "@/components/atoms/icons";

type ErrorAlertProps = {
  title: string;
  message: string;
  className?: string;
};

export function ErrorAlert({ title, message, className }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3",
        className,
      )}
    >
      <AlertCircleIcon size={16} className="mt-px shrink-0 text-red-600" />
      <div>
        <div className="text-[13px] font-semibold text-red-700">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-red-800">{message}</div>
      </div>
    </div>
  );
}
