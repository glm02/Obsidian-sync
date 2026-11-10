import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInvitation, obsidianInvitationUrl } from "../src/lib/invitation.ts";

test("lit le serveur encodé et conserve le code", () => {
  assert.deepEqual(parseInvitation("#serveur=https%3A%2F%2Fcordee.exemple.fr&code=ABCD-EFGH-JKLM"), {
    serveur: "https://cordee.exemple.fr", code: "ABCD-EFGH-JKLM",
  });
  assert.deepEqual(parseInvitation("#serveur=http%3A%2F%2F203.0.113.10%3A8787&code=A"), {
    serveur: "http://203.0.113.10:8787", code: "A",
  });
});

test("le lien ouvre Obsidian avec les paramètres encodés, sans passer par une requête web", () => {
  const url = new URL(obsidianInvitationUrl({ serveur: "https://cordee.exemple.fr", code: "ABCD-EFGH-JKLM" }));
  assert.equal(url.protocol, "obsidian:");
  assert.equal(url.hostname, "cordee");
  assert.equal(url.searchParams.get("serveur"), "https://cordee.exemple.fr");
  assert.equal(url.searchParams.get("code"), "ABCD-EFGH-JKLM");
});

test("rejette les invitations absentes, ambiguës ou malformées", () => {
  for (const fragment of [
    "", "#", "#code=ABC", "#serveur=https://cordee.exemple.fr",
    "#serveur=javascript:alert(1)&code=ABC", "#serveur=ftp://cordee.exemple.fr&code=ABC",
    "#serveur=https://&code=ABC", "#serveur=https://cordee.exemple.fr&code=",
    "#serveur=https://cordee.exemple.fr&code=" + "A".repeat(21),
    "#serveur=https://cordee.exemple.fr&code=%3Cscript%3E",
    "#serveur=https://cordee.exemple.fr&code=A&code=B",
    "#serveur=https://cordee.exemple.fr&serveur=http://203.0.113.10&code=A",
    "#serveur=https://agent-local:secret@cordee.exemple.fr&code=A",
  ]) assert.equal(parseInvitation(fragment), null, fragment);
});
