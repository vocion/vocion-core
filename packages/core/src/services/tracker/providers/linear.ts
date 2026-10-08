/**
 * LINEAR — the second provider of the tracker family (`../provider.ts`), on
 * the GraphQL client and credential the `linear` source syncs with
 * (`libs/sources/linear.ts`). The agent's tools and the `tracker.*` actions
 * are the ones Jira answers; nothing the agent is told changes.
 *
 * Where Linear's model differs from the family's, this file says so rather
 * than pretending:
 *   - a status change is a workflow state of the issue's team; every state is
 *     a "transition" from every other, so the list is the team's states;
 *   - there are no issue types. A type the agent names that is also a label
 *     of the team (Bug, Feature) is added as that label; otherwise it is left;
 *   - there are no fix versions, so an update naming one is refused by name;
 *   - a remote issue link is a link attachment, removed with it on Undo;
 *   - priorities are numbers (1 Urgent … 4 Low); the family's names map on;
 *   - deleting an issue moves it to Linear's trash, restorable for 30 days.
 */

import type { TrackerIssue, TrackerPreviousFields, TrackerProvider, TrackerSearchRow, TrackerTransition } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { LinearIssue } from '@/libs/sources/linear';
import { Buffer } from 'node:buffer';
import { vendorRequest } from '@/libs/connectors/vendorRequest';
import { LINEAR_ISSUE_FIELDS, linearAuthorization, linearGraphql, linearStatusCategory, linearTokenFrom } from '@/libs/sources/linear';
import { credentialsForSource } from '@/services/connectors/sourceCredentials';
import { projectKeysOf } from '../provider';

/** The family's (and Jira's) priority names, as Linear's numbers. */
const PRIORITY: Record<string, number> = { 'urgent': 1, 'highest': 1, 'high': 2, 'medium': 3, 'normal': 3, 'low': 4, 'lowest': 4, 'none': 0, 'no priority': 0 };

type State = { id: string; name: string; type: string };
type FullIssue = LinearIssue & {
  comments?: { nodes?: Array<{ id: string; body?: string | null; createdAt?: string | null; user?: { name?: string | null; email?: string | null } | null }> } | null;
  attachments?: { nodes?: Array<{ id: string; title?: string | null; url?: string | null; createdAt?: string | null }> } | null;
  relations?: { nodes?: Array<{ type: string; relatedIssue?: { identifier: string; title?: string | null } | null }> } | null;
  inverseRelations?: { nodes?: Array<{ type: string; issue?: { identifier: string; title?: string | null } | null }> } | null;
  teamStates?: { states?: { nodes?: State[] } | null } | null;
};

const READ_ISSUE = `query Issue($id: String!) { issue(id: $id) {
  ${LINEAR_ISSUE_FIELDS}
  comments(first: 100) { nodes { id body createdAt user { name email } } }
  attachments(first: 50) { nodes { id title url createdAt } }
  relations(first: 50) { nodes { type relatedIssue { identifier title } } }
  inverseRelations(first: 50) { nodes { type issue { identifier title } } }
  teamStates: team { states(first: 100) { nodes { id name type } } }
} }`;

function personName(user: { name?: string | null; email?: string | null } | null | undefined): string | null {
  return user?.name ?? user?.email ?? null;
}

/**
 * A priority as Linear's number.
 * @param name - The priority, as the agent or the family names it.
 */
export function linearPriority(name: string): number {
  const n = PRIORITY[name.trim().toLowerCase()];
  if (n === undefined) {
    throw new Error(`Linear has no priority "${name}". It has Urgent, High, Medium, Low and No priority.`);
  }
  return n;
}

/**
 * The Linear provider for one tracker source.
 * @param orgId - The workspace.
 * @param source - The `linear` source row (team keys, credential).
 */
export async function linearTrackerProvider(orgId: string, source: FamilySource): Promise<TrackerProvider> {
  const parsed = linearTokenFrom(await credentialsForSource(orgId, source));
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const token = parsed.token;
  const projectKeys = projectKeysOf(source);

  const gql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const res = await linearGraphql<T>(token, query, variables);
    if (!res.ok) {
      throw new Error(res.message);
    }
    return res.data;
  };
  const mutate = async (query: string, variables: Record<string, unknown>, field: string): Promise<Record<string, unknown>> => {
    const data = await gql<Record<string, { success?: boolean } & Record<string, unknown>>>(query, variables);
    const payload = data[field];
    if (!payload?.success) {
      throw new Error(`Linear did not apply ${field}.`);
    }
    return payload;
  };

  const { organization } = (await gql<{ viewer: { organization: { urlKey: string } } }>('query { viewer { organization { urlKey } } }')).viewer;
  const issueUrl = (key: string): string => `https://linear.app/${organization.urlKey}/issue/${key}`;

  const readFull = (key: string) => gql<{ issue: FullIssue | null }>(READ_ISSUE, { id: key }).then((d) => {
    if (!d.issue) {
      throw new Error(`Linear has no issue ${key}.`);
    }
    return d.issue;
  });
  const statesOf = (issue: FullIssue): State[] => issue.teamStates?.states?.nodes ?? [];
  const asTransitions = (states: State[], current: string | undefined): TrackerTransition[] => states.filter(s => s.id !== current).map(s => ({ id: s.id, name: s.name, to: s.name }));

  /**
   * Label ids for names, from the team's labels and the workspace's. Every name must exist.
   * @param teamKey - The issue's team.
   * @param names - The label names.
   */
  const labelIds = async (teamKey: string, names: string[]): Promise<string[]> => {
    if (names.length === 0) {
      return [];
    }
    const { issueLabels } = await gql<{ issueLabels: { nodes: Array<{ id: string; name: string; team?: { key: string } | null }> } }>(
      'query Labels($names: [String!]) { issueLabels(first: 250, filter: { name: { in: $names } }) { nodes { id name team { key } } } }',
      { names },
    );
    const usable = issueLabels.nodes.filter(l => !l.team || l.team.key.toUpperCase() === teamKey.toUpperCase());
    const missing = names.filter(n => !usable.some(l => l.name.toLowerCase() === n.toLowerCase()));
    if (missing.length > 0) {
      throw new Error(`Linear team ${teamKey} has no label ${missing.map(m => `"${m}"`).join(', ')}. Labels are made in Linear, not here.`);
    }
    return names.map(n => usable.find(l => l.name.toLowerCase() === n.toLowerCase())!.id);
  };

  const transitions = async (key: string): Promise<TrackerTransition[]> => {
    const issue = await readFull(key);
    return asTransitions(statesOf(issue), issue.state?.id);
  };

  return {
    kind: 'linear',
    sourceSlug: source.slug,
    projectKeys,
    issueUrl,
    transitions,

    async readIssue(key) {
      const issue = await readFull(key);
      const out: TrackerIssue = {
        key: issue.identifier,
        url: issue.url,
        summary: issue.title,
        description: issue.description ?? '',
        status: issue.state?.name ?? 'Unknown',
        statusCategory: linearStatusCategory(issue.state?.type),
        issueType: null,
        priority: issue.priorityLabel ?? null,
        labels: (issue.labels?.nodes ?? []).map(l => l.name),
        assignee: personName(issue.assignee),
        reporter: personName(issue.creator),
        created: issue.createdAt ?? null,
        updated: issue.updatedAt ?? null,
        fixVersions: [],
        comments: (issue.comments?.nodes ?? []).map(c => ({ id: c.id, author: personName(c.user), created: c.createdAt ?? null, body: c.body ?? '' })),
        attachments: (issue.attachments?.nodes ?? []).map(a => ({ id: a.id, filename: a.title ?? a.url ?? a.id, mimeType: null, size: null, created: a.createdAt ?? null })),
        links: [
          ...(issue.relations?.nodes ?? []).flatMap(r => (r.relatedIssue ? [{ type: r.type, key: r.relatedIssue.identifier, summary: r.relatedIssue.title ?? null }] : [])),
          ...(issue.inverseRelations?.nodes ?? []).flatMap(r => (r.issue ? [{ type: `${r.type} (inverse)`, key: r.issue.identifier, summary: r.issue.title ?? null }] : [])),
        ],
        transitions: asTransitions(statesOf(issue), issue.state?.id),
      };
      return out;
    },

    async searchIssues(query, limit) {
      if (projectKeys.length === 0) {
        throw new Error(`The ${source.slug} source lists no team keys, so there is nothing to search.`);
      }
      const term = query.trim();
      const filter: Record<string, unknown> = { team: { key: { in: projectKeys } } };
      if (term) {
        filter.or = [{ title: { containsIgnoreCase: term } }, { description: { containsIgnoreCase: term } }];
      }
      const data = await gql<{ issues: { nodes: LinearIssue[] } }>(
        `query Search($filter: IssueFilter, $first: Int) { issues(filter: $filter, first: $first, orderBy: updatedAt) { nodes { ${LINEAR_ISSUE_FIELDS} } } }`,
        { filter, first: Math.min(limit, 50) },
      );
      return data.issues.nodes.slice(0, limit).map((i): TrackerSearchRow => ({ key: i.identifier, summary: i.title, status: i.state?.name ?? 'Unknown', assignee: personName(i.assignee), updated: i.updatedAt ?? null, url: i.url }));
    },

    async readAttachment(id) {
      const { attachment } = await gql<{ attachment: { title?: string | null; url?: string | null } | null }>('query A($id: String!) { attachment(id: $id) { title url } }', { id });
      if (!attachment?.url) {
        throw new Error(`Linear has no attachment ${id}.`);
      }
      let host = '';
      try {
        host = new URL(attachment.url).hostname;
      } catch {}
      if (host !== 'uploads.linear.app') {
        throw new Error(`Attachment ${id} is a link, not a file: ${attachment.url}. Read it with fetch_url if it is public.`);
      }
      const res = await vendorRequest<Buffer>({ vendor: 'Linear', url: attachment.url, headers: { authorization: linearAuthorization(token), accept: '*/*' }, read: 'bytes' });
      if (!res.ok) {
        throw new Error(res.message);
      }
      return { filename: attachment.title ?? `attachment-${id}`, mimeType: res.headers.get('content-type') ?? 'application/octet-stream', bytes: res.data };
    },

    async createIssue(input) {
      const { teams } = await gql<{ teams: { nodes: Array<{ id: string; key: string }> } }>('query T($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id key } } }', { key: input.projectKey.toUpperCase() });
      const team = teams.nodes[0];
      if (!team) {
        throw new Error(`Linear has no team ${input.projectKey}.`);
      }
      const ids = await labelIds(team.key, input.labels ?? []);
      // No issue types on Linear: a type that is also a label of the team rides as that label.
      const typeLabel = input.issueType ? await labelIds(team.key, [input.issueType]).catch(() => []) : [];
      const payload = await mutate(
        'mutation C($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }',
        { input: { teamId: team.id, title: input.summary, description: input.description, labelIds: [...new Set([...ids, ...typeLabel])], ...(input.priority ? { priority: linearPriority(input.priority) } : {}) } },
        'issueCreate',
      );
      const issue = payload.issue as { identifier: string; url: string };
      return { key: issue.identifier, url: issue.url };
    },

    async deleteIssue(key) {
      const issue = await readFull(key);
      await mutate('mutation D($id: String!) { issueDelete(id: $id) { success } }', { id: issue.id }, 'issueDelete');
    },

    async transition(key, to) {
      const issue = await readFull(key);
      const states = statesOf(issue);
      const wanted = to.trim().toLowerCase();
      const state = states.find(s => s.id === to.trim()) ?? states.find(s => s.name.toLowerCase() === wanted);
      if (!state) {
        throw new Error(`${key} has no state "${to}" on its team. States: ${states.map(s => s.name).join(', ') || 'none'}.`);
      }
      await mutate('mutation U($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id: issue.id, input: { stateId: state.id } }, 'issueUpdate');
      return { from: issue.state?.name ?? 'Unknown', to: state.name };
    },

    async updateIssue(key, fields) {
      if (fields.fixVersion !== undefined) {
        throw new Error('Linear has no fix versions. Name the release in a label or a comment instead.');
      }
      const issue = await readFull(key);
      const previous: TrackerPreviousFields = {};
      const input: Record<string, unknown> = {};
      if (fields.priority !== undefined) {
        previous.priority = issue.priorityLabel ?? null;
        input.priority = linearPriority(fields.priority);
      }
      if (fields.labels !== undefined) {
        previous.labels = (issue.labels?.nodes ?? []).map(l => l.name);
        input.labelIds = await labelIds(issue.team?.key ?? key.split('-')[0]!, fields.labels);
      }
      if (Object.keys(input).length > 0) {
        await mutate('mutation U($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id: issue.id, input }, 'issueUpdate');
      }
      if (fields.remoteLink) {
        const payload = await mutate(
          'mutation L($issueId: String!, $url: String!, $title: String) { attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success attachment { id } } }',
          { issueId: issue.id, url: fields.remoteLink.url, title: fields.remoteLink.title },
          'attachmentLinkURL',
        );
        previous.remoteLinkId = (payload.attachment as { id?: string } | undefined)?.id ?? null;
      }
      return previous;
    },

    async removeRemoteLink(_key, linkId) {
      await mutate('mutation R($id: String!) { attachmentDelete(id: $id) { success } }', { id: linkId }, 'attachmentDelete');
    },

    async addComment(key, text) {
      const issue = await readFull(key);
      const payload = await mutate('mutation C($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }', { input: { issueId: issue.id, body: text } }, 'commentCreate');
      const comment = payload.comment as { id: string; url?: string };
      return { id: comment.id, url: comment.url ?? issue.url };
    },

    async deleteComment(_key, id) {
      await mutate('mutation D($id: String!) { commentDelete(id: $id) { success } }', { id }, 'commentDelete');
    },

    async attach(key, file) {
      const issue = await readFull(key);
      const upload = await mutate(
        'mutation F($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }',
        { contentType: file.mimeType, filename: file.filename, size: file.bytes.byteLength },
        'fileUpload',
      );
      const target = upload.uploadFile as { uploadUrl: string; assetUrl: string; headers?: Array<{ key: string; value: string }> };
      const headers: Record<string, string> = { 'content-type': file.mimeType, 'cache-control': 'public, max-age=31536000' };
      for (const h of target.headers ?? []) {
        headers[h.key] = h.value;
      }
      const put = await vendorRequest({ vendor: 'Linear', url: target.uploadUrl, method: 'PUT', headers, body: new Uint8Array(Buffer.from(file.bytes)), read: 'text' });
      if (!put.ok) {
        throw new Error(`Linear did not take the file: ${put.message}`);
      }
      const payload = await mutate(
        'mutation A($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success attachment { id } } }',
        { input: { issueId: issue.id, url: target.assetUrl, title: file.filename } },
        'attachmentCreate',
      );
      return { id: (payload.attachment as { id: string }).id };
    },

    async deleteAttachment(id) {
      await mutate('mutation R($id: String!) { attachmentDelete(id: $id) { success } }', { id }, 'attachmentDelete');
    },

    async findUserByEmail(email) {
      const { users } = await gql<{ users: { nodes: Array<{ id: string; name?: string; displayName?: string }> } }>('query U($email: String!) { users(filter: { email: { eq: $email } }) { nodes { id name displayName } } }', { email });
      const user = users.nodes[0];
      return user ? { accountId: user.id, displayName: user.displayName ?? user.name ?? '' } : null;
    },
  };
}
