"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { faq } from "@/lib/home-content";

export function Faq() {
  return <Accordion type="single" collapsible>{faq.map(([q, a], i) => <AccordionItem key={q} value={`question-${i}`}><AccordionTrigger>{q}</AccordionTrigger><AccordionContent>{a}</AccordionContent></AccordionItem>)}</Accordion>;
}
