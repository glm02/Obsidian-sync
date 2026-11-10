import Image from "next/image";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center", className)}>
    <Image src="/brand/cordee-logo.svg" alt="Cordée" width={1016} height={256} className="h-auto w-40" unoptimized />
  </span>;
}
