# Mistral

Mistral as a model provider for any agent, on the workspace's own Mistral key.

- **Key.** API credentials → Mistral (`mistral` platform), or `MISTRAL_API_KEY` on the server.
  The workspace's key wins, so its usage lands on its own Mistral bill.
- **Use it for an agent.** `harness: { modelProvider: mistral, model: mistral-large-latest }` in
  the agent's YAML, or `VOCION_LLM_PROVIDER=mistral` for the whole deployment. Defaults per role:
  `mistral-large-latest` (main), `mistral-small-latest` (classifier), `mistral-medium-latest`
  (extractor).
- **How.** Mistral's API speaks OpenAI's chat-completions format, so core reaches it through the
  same path as Azure, Vertex and self-hosted servers (`libs/llm/openaiCompatible.ts`) — tool calls
  included. Stream usage is not requested (Mistral reports it on the last chunk).
- **Price.** `mistral-large-latest` is priced in `libs/pricing.ts` from mistral.ai/pricing
  (2026-10-08); the other Mistral models record their tokens at 0 cents until priced.
- **Embeddings stay where they were.** Mistral's embeddings are not 1536 wide, so a deployment on
  `VOCION_LLM_PROVIDER=mistral` keeps embedding on OpenAI.
