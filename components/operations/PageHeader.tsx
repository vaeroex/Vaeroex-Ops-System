import type { ReactNode } from "react";
import { ContextualHelp } from "@/components/help/ContextualHelp";
import { DecisionPageHeader } from "@/components/operations/DecisionPageHeader";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <DecisionPageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} help={<ContextualHelp title={title} eyebrow={eyebrow} />} />
  );
}
