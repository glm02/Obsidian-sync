"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" /><DialogPrimitive.Content data-slot="dialog-content" className={cn("fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-input bg-background p-6 shadow-2xl outline-none sm:p-8", className)} {...props}>{children}<DialogPrimitive.Close className="absolute right-3 top-3 flex size-8 cursor-pointer items-center justify-center rounded-full text-soft outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" /><span className="sr-only">Fermer</span></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal>;
}
export { Dialog, DialogTrigger, DialogTitle, DialogDescription, DialogContent };
