export type Invitation = { serveur: string; code: string };

export function obsidianInvitationUrl(invitation: Invitation): string {
  return `obsidian://cordee?${new URLSearchParams(invitation).toString()}`;
}

export function parseInvitation(fragment: string): Invitation | null {
  try {
    const params = new URLSearchParams(fragment.replace(/^#/, ""));
    if (params.getAll("serveur").length !== 1 || params.getAll("code").length !== 1) return null;
    const serveur = params.get("serveur") ?? "";
    const code = params.get("code") ?? "";
    if (!/^https?:\/\//i.test(serveur) || !/^[A-Za-z0-9-]{1,20}$/.test(code)) return null;
    const url = new URL(serveur);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    return { serveur, code };
  } catch { return null; }
}
