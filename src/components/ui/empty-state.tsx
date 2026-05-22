import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; href: string };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        {icon && <div className="text-muted-foreground/30 mb-3 flex justify-center">{icon}</div>}
        <h3 className="font-heading font-semibold text-lg">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-1 mb-4">{description}</p>}
        {action && (
          <Button asChild>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
