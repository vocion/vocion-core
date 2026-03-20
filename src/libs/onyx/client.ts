/**
 * Onyx API Client
 *
 * Wraps the Onyx REST API for use by CoreContext.
 * Onyx runs locally at http://localhost:8080 (self-hosted)
 * or at https://cloud.onyx.app/api (cloud).
 *
 * API docs: {ONYX_BASE_URL}/api/docs
 */

const getBaseUrl = () => {
  const url = process.env.ONYX_API_URL || 'http://localhost:8080';
  return url.replace(/\/$/, '');
};

const getApiKey = () => {
  const key = process.env.ONYX_API_KEY;
  if (!key) {
    throw new Error('ONYX_API_KEY is not configured. Create an API key in Onyx admin.');
  }
  return key;
};

const getAdminKey = () => {
  return process.env.ONYX_API_ADMIN_KEY || getApiKey();
};

const headers = () => ({
  'Authorization': `Bearer ${getApiKey()}`,
  'Content-Type': 'application/json',
});

const adminHeaders = () => ({
  'Authorization': `Bearer ${getAdminKey()}`,
  'Content-Type': 'application/json',
});

/* ------------------------------------------------------------------ */
/* Chat                                                               */
/* ------------------------------------------------------------------ */

export type ChatMessageRequest = {
  message: string;
  chat_session_id?: string;
  chat_session_info?: {
    persona_id: number;
    project_id?: number;
  };
  search_filters?: {
    source_type?: string[];
    document_set?: string[];
    time_cutoff?: string;
    tags?: string[];
  };
  stream?: boolean;
  include_citations?: boolean;
  additional_context?: string;
  llm_override?: {
    model_provider?: string;
    model_version?: string;
    temperature?: number;
  };
};

export type ChatResponse = {
  answer: string;
  answer_citationless: string;
  pre_answer_reasoning?: string;
  tool_calls: any[];
  top_documents: any[];
  citation_info: any[];
  message_id: number;
  chat_session_id: string;
};

export async function sendChatMessage(request: ChatMessageRequest): Promise<ChatResponse> {
  const res = await fetch(`${getBaseUrl()}/chat/send-chat-message`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ...request,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Onyx chat error (${res.status}): ${text}`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

export type SearchRequest = {
  query: string;
  search_filters?: {
    source_type?: string[];
    document_set?: string[];
    time_cutoff?: string;
    tags?: string[];
  };
};

export async function search(request: SearchRequest): Promise<any> {
  // Onyx uses /admin/search with a "filters" object
  const body: Record<string, unknown> = {
    query: request.query,
    filters: {} as Record<string, unknown>,
  };

  if (request.search_filters?.source_type) {
    (body.filters as Record<string, unknown>).source_type = request.search_filters.source_type;
  }
  if (request.search_filters?.document_set) {
    (body.filters as Record<string, unknown>).document_set = request.search_filters.document_set;
  }
  if (request.search_filters?.time_cutoff) {
    (body.filters as Record<string, unknown>).time_cutoff = request.search_filters.time_cutoff;
  }
  if (request.search_filters?.tags) {
    (body.filters as Record<string, unknown>).tags = request.search_filters.tags;
  }

  const res = await fetch(`${getBaseUrl()}/admin/search`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Onyx search error (${res.status}): ${text}`);
  }

  const data = await res.json();
  // Normalize response: /admin/search returns "documents" not "top_documents"
  return { top_documents: data.documents ?? data.top_documents ?? [], ...data };
}

/* ------------------------------------------------------------------ */
/* Connectors                                                         */
/* ------------------------------------------------------------------ */

export async function listConnectors(): Promise<any[]> {
  const res = await fetch(`${getBaseUrl()}/manage/connector`, {
    headers: headers(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Onyx connectors error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getConnectorStatus(): Promise<any[]> {
  const res = await fetch(`${getBaseUrl()}/manage/admin/connector/indexing-status`, {
    headers: headers(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Onyx connector status error (${res.status}): ${text}`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/* Agents (Personas)                                                  */
/* ------------------------------------------------------------------ */

export async function listAgents(): Promise<any[]> {
  const res = await fetch(`${getBaseUrl()}/persona`, {
    headers: headers(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Onyx agents error (${res.status}): ${text}`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/* Documents / Ingestion                                              */
/* ------------------------------------------------------------------ */

export async function ingestDocuments(documents: any[]): Promise<any> {
  const res = await fetch(`${getBaseUrl()}/manage/admin/ingestion`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ documents }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Onyx ingestion error (${res.status}): ${text}`);
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/* Health Check                                                       */
/* ------------------------------------------------------------------ */

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl()}/health`, {
      headers: headers(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
