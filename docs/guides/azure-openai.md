# Azure OpenAI

OpenAI models deployed on an Azure OpenAI (or Azure AI Foundry) resource, for chat and for
embeddings, billed to your Azure subscription.

- **Credential.** API credentials → Azure OpenAI: the resource **endpoint**
  (`https://<resource>.openai.azure.com`) and one of its **keys**, both from Keys and Endpoint.
  Server fallback: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`.
- **Chat.** `harness: { modelProvider: azure-openai, model: <deployment name> }` — Azure routes on
  the **deployment**, so `model` is what you named it. Defaults assume deployments named after
  their models (`gpt-4o`, `gpt-4o-mini`). Calls use the resource's v1 API
  (`<endpoint>/openai/v1/`), the plain OpenAI format, so tool calls and streamed usage work as on
  OpenAI.
- **Embeddings.** `defaults: { embeddingProvider: azure-openai }` embeds on a deployment named
  `text-embedding-3-small` (or `embeddingModel:`). Its vectors are 1536 wide; every batch is
  width-checked before it is stored, and a `text-embedding-3-large` deployment (3072) is refused
  with the reason rather than failing at insert.
- **Price.** Usage is priced by the model id Azure reports (`gpt-4o`, `text-embedding-3-small`),
  at OpenAI's list prices in `libs/pricing.ts`; your Azure agreement may differ.
