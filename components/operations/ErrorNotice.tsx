import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { isSecurityResponseMessage } from "@/lib/security/security-response";

type ErrorNoticeProps = {
  message?: string | null;
};

export function ErrorNotice({ message }: ErrorNoticeProps) {
  if (!message) {
    return null;
  }

  if (isSecurityResponseMessage(message)) {
    return <SecurityResponseNotice />;
  }

  return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</div>;
}
