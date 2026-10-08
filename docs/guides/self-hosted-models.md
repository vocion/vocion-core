# Self-hosted models (OpenAI-compatible)

Any model server that speaks OpenAI's chat-completions API — **vLLM**, **Ollama**, **LM Studio**,
or a gateway in front of them — as a model provider, so an agent can run on hardware you own.

- **Credential.** API credentials → "Self-hosted model (OpenAI-compatible)": the **base URL**
  (ending `/v1`; Ollama is `http://<host>:11434/v1`, vLLM `http://<host>:8000/v1`) and, only if the
  server asks for one, a **key**. Server fallback: `VOCION_OPENAI_COMPATIBLE_BASE_URL`,
  `VOCION_OPENAI_COMPATIBLE_API_KEY`.
- **Use it for an agent.** `harness: { modelProvider: openai-compatible, model: llama3.1 }` — the
  model is whatever name your server serves. `VOCION_LLM_MODEL_MAIN` sets the deployment's default.
- **Tools.** Agents call tools, so serve a model and a server build that support OpenAI-style tool
  calling (vLLM with `--enable-auto-tool-choice`, recent Ollama).
- **Cost.** The tokens run on your hardware: Vocion records them and prices them at 0, so a token
  budget still caps an agent and a cents budget does not apply.
- **Reachability.** The base URL must be reachable from the Vocion server, not from a browser.
- **Embeddings** stay on OpenAI (or Bedrock / Azure / Vertex): self-hosted embedding models are
  rarely 1536 wide, and the column is.
