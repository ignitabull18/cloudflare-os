function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;",
  })[character]!);
}

export function connectFormHtml(actionUrl: string, error?: string, containerTag = "default"): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Supermemory</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#f5f3ff;color:#18181b}
main{max-width:520px;margin:48px auto;padding:28px;background:white;border:1px solid #ddd6fe;border-radius:16px}
h1{margin:0 0 8px}.sub{color:#52525b;line-height:1.5}.err{padding:10px;background:#fee2e2;color:#991b1b;border-radius:8px}
label{display:block;margin:18px 0 6px;font-weight:650}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #a1a1aa;border-radius:8px;font:inherit}
.hint{font-size:13px;color:#71717a}button{width:100%;margin-top:22px;padding:11px;border:0;border-radius:9px;background:#6d28d9;color:white;font:inherit;font-weight:700}
@media(prefers-color-scheme:dark){body{background:#18112a;color:#fafafa}main{background:#211936;border-color:#4c1d95}.sub,.hint{color:#c4b5fd}input{background:#18181b;color:white}}
</style></head><body><main><h1>Connect Supermemory</h1>
<p class="sub">Use an organization API key so builder agents can create isolated spaces, scoped keys, and source connectors. The key remains inside this gatekeeper.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<form method="POST" action="${escapeHtml(actionUrl)}">
<label for="apiKey">Organization API key</label><input id="apiKey" type="password" name="apiKey" required autocomplete="off">
<p class="hint">Create this in the Supermemory Developer Platform. Scoped keys cannot provide organization management.</p>
<label for="containerTag">Default agent memory space</label><input id="containerTag" name="containerTag" value="${escapeHtml(containerTag)}" required pattern="[A-Za-z0-9_.:-]{1,100}">
<p class="hint">This container becomes the ambient memory capability. Additional containers stay explicit.</p>
<button type="submit">Connect Supermemory</button></form></main></body></html>`;
}
