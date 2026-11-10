"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

function Accordion(props: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}
function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn("border-b border-border", className)} {...props} />;
}
function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return <AccordionPrimitive.Header><AccordionPrimitive.Trigger data-slot="accordion-trigger" className={cn("flex w-full cursor-pointer items-center justify-between gap-6 rounded-md py-5 text-left text-sm outline-none transition-colors duration-150 hover:text-soft focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]>svg]:rotate-45", className)} {...props}>{children}<Plus className="size-4 shrink-0 text-soft transition-transform duration-150" aria-hidden="true" /></AccordionPrimitive.Trigger></AccordionPrimitive.Header>;
}
function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content data-slot="accordion-content" className="overflow-hidden" {...props}><div className={cn("max-w-2xl pb-5 text-sm leading-7 text-soft", className)}>{children}</div></AccordionPrimitive.Content>;
}
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
