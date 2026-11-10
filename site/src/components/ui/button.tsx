import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  { variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:bg-primary/85 border border-white/10",
      outline: "border border-input bg-background text-foreground hover:bg-secondary",
      ghost: "text-soft hover:bg-secondary hover:text-foreground",
    },
    size: { default: "h-11 px-5", sm: "h-9 px-3 text-xs", icon: "size-9" },
  }, defaultVariants: { variant: "default", size: "default" } },
);

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
export { Button, buttonVariants };
