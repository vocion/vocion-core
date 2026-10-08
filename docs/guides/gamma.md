# Gamma

Decks, documents and web pages made from an agent's work, in the workspace's own Gamma account.

| | |
|---|---|
| Auth | Gamma API key (`gamma` platform; Pro, Ultra, Teams or Business plan). Works today; no OAuth app. Server fallback `GAMMA_API_KEY`. |
| Syncs | Nothing — a deck is made when asked. The `gamma` connector exists for the tile, the vault and Test connection. |
| Actions | `deck.create` — title, content, format (presentation / document / webpage), cards, text mode, instructions, optional PDF/PPTX export. Returns the Gamma link. **No Undo**: Gamma's API cannot delete a deck; it stays in Gamma, where a person can delete it. External, so the trust ladder decides whether an agent's deck waits for a person. |
| Also | The proposal card's **Send to Gamma** uses the same key. |

Test connection reads the account's themes and spends no credits. Making a deck spends the
account's Gamma credits.
