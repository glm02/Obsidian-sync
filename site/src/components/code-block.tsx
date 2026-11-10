import { CopyButton } from "@/components/copy-button";

export function CodeBlock({ title = "Terminal", children }: { title?: string; children: string }) {
  return <div className="code-block my-5 overflow-hidden rounded-lg border border-input">
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2">
      <span className="text-xs text-soft">{title}</span><CopyButton text={children} />
    </div>
    <pre tabIndex={0} aria-label={title} className="overflow-x-auto p-4 text-xs leading-6 sm:text-[13px]"><code>{children}</code></pre>
  </div>;
}
