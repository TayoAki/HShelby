import { AuthGate } from "@/components/AuthGate";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AuthGate>{children}</AuthGate>;
}
