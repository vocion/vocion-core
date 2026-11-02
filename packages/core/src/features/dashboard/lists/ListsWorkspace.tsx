'use client';

import type { ListField } from '@/libs/lists/spec';
import type { listLists, readList } from '@/services/lists/service';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';

type Detail = Awaited<ReturnType<typeof readList>>;
type Catalog = Awaited<ReturnType<typeof listLists>>;
type Values = Record<string, string | number | boolean | null>;

async function request<T>(body?: Record<string, unknown>, query = ''): Promise<T> {
  const response = await fetch(`/api/v1/lists${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message ?? result.message ?? 'Could not load this List');
  }
  return result as T;
}

/**
 * One live table for people and chat; edits use the same versioned service.
 * @param root0
 * @param root0.id
 */
export function ListsWorkspace({ id }: { id?: string }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('leads');
  const [scope, setScope] = useState('personal');
  const [editing, setEditing] = useState<{ id: string; version: number; values: Values }>();
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<'text' | 'number' | 'boolean' | 'date'>('text');
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    if (id) {
      setDetail(await request<Detail>(undefined, `?id=${encodeURIComponent(id)}&offset=${offset}${view ? `&view=${encodeURIComponent(view)}` : ''}`));
    } else {
      setCatalog(await request<Catalog>(undefined, `?offset=${offset}`));
    }
  }, [id, offset, view]);

  useEffect(() => {
    void load().catch(e => setError(e.message));
  }, [load]);

  useEffect(() => {
    let alive = true;
    const refresh = () => load().catch((e) => {
      if (alive) {
        setError(e.message);
      }
    });
    const timer = setInterval(() => {
      if (!editing && !busy) {
        void refresh();
      }
    }, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load, editing, busy]);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await request(body);
      setEditing(undefined);
      setCreating(false);
      await load();
      setNotice('Saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  function startingFields(): ListField[] {
    return kind === 'leads'
      ? [{ key: 'name', label: 'Name', type: 'text' }, { key: 'company', label: 'Company', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'source', label: 'Source', type: 'text' }, { key: 'notes', label: 'Notes', type: 'text' }]
      : [{ key: 'task', label: kind === 'plan' ? 'Step' : 'Follow-up', type: 'text' }, { key: 'owner', label: 'Owner', type: 'text' }, { key: 'due', label: 'Due', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Done', 'Dropped'] }];
  }

  const list = detail?.list;
  return (
    <>
      <TitleBar title={list?.title ?? 'Lists'} description={list ? `${list.scope === 'personal' ? 'Only you' : 'Workspace members'} · ${detail.total} records · Version ${list.version}${list.archived ? ' · Archived' : ''}` : 'Lead lists, follow-ups and plans you can build in chat and keep working here.'} />
      <div className="space-y-5 p-4 md:p-6">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {!id && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setCreating(v => !v)}>New List</Button>
              {catalog?.canManageWorkspace && <Button variant="outline" disabled={busy} onClick={() => void run({ action: 'crm' })}>Install CRM starter</Button>}
              <Link className="self-center text-sm underline" href="/dashboard/chat">Build a List in chat</Link>
            </div>
            {creating && (
              <form
                className="grid max-w-xl gap-3 rounded-lg border p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run({ action: 'create', id: crypto.randomUUID(), title, scope, fields: startingFields() });
                }}
              >
                <label htmlFor="list-name" className="text-sm">
                  List name
                  <Input id="list-name" required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="Conference follow-ups" />
                </label>
                <label className="text-sm">
                  Start with
                  <select className="block w-full rounded border bg-background p-2" value={kind} onChange={e => setKind(e.target.value)}>
                    <option value="leads">Leads</option>
                    <option value="followups">Follow-ups</option>
                    <option value="plan">Plan</option>
                  </select>
                </label>
                <label className="text-sm">
                  Who can see it
                  <select className="block w-full rounded border bg-background p-2" value={scope} onChange={e => setScope(e.target.value)}>
                    <option value="personal">Only me</option>
                    {catalog?.canManageWorkspace && <option value="workspace">Workspace members</option>}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">Lists stay saved until you archive them. Follow-up rows do not schedule reminders or send messages.</p>
                <Button disabled={busy} type="submit">Create List</Button>
              </form>
            )}
            <div className="divide-y rounded-lg border">
              {catalog?.items.map(item => (
                <Link key={item.id} href={`/dashboard/lists/${item.id}`} className="flex min-h-16 items-center justify-between gap-3 p-4 hover:bg-muted">
                  <span>
                    <strong className="font-medium">{item.title}</strong>
                    <span className="block text-sm text-muted-foreground">{item.purpose || `${item.fields.length} fields`}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.scope === 'personal' ? 'Only you' : 'Workspace'}
                    {item.archived ? ' · Archived' : ''}
                  </span>
                </Link>
              ))}
              {catalog?.items.length === 0 && <p className="p-8 text-sm text-muted-foreground">Create your first List here, or ask chat to build one from your criteria.</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}>Previous</Button>
              <Button variant="outline" disabled={!catalog?.nextOffset} onClick={() => setOffset(catalog?.nextOffset ?? 0)}>Next</Button>
            </div>
          </>
        )}
        {list && detail && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/dashboard/lists" className="mr-3 text-sm underline">All Lists</Link>
              <Button disabled={busy || list.archived} onClick={() => setEditing({ id: crypto.randomUUID(), version: list.version, values: {} })}>Add record</Button>
              {detail.canConfigure && <Button variant="outline" disabled={busy} onClick={() => void run({ action: 'configure', id, expectedVersion: list.version, archived: !list.archived })}>{list.archived ? 'Restore' : 'Archive'}</Button>}
              {detail.canPromote && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setSharing(true)}
                >
                  Share with workspace
                </Button>
              )}
              {list.views.length > 0 && (
                <label className="text-sm">
                  View
                  <select
                    className="rounded border bg-background p-2"
                    value={view}
                    onChange={(e) => {
                      setView(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">All records</option>
                    {list.views.map(v => <option key={v.name}>{v.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {sharing && (
              <div className="rounded-lg border p-4">
                <p className="mb-3 text-sm">Share every record and its history with all members of this workspace?</p>
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setSharing(false);
                      void run({ action: 'configure', id, expectedVersion: list.version, scope: 'workspace' });
                    }}
                  >
                    Share List
                  </Button>
                  <Button variant="outline" onClick={() => setSharing(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {editing && (
              <form
                className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  const values = Object.fromEntries(list.fields.map((field) => {
                    const raw = String(form.get(field.key) ?? '');
                    return [field.key, raw === '' ? null : field.type === 'number' ? Number(raw) : field.type === 'boolean' ? raw === 'true' : raw];
                  }));
                  void run({ action: 'write', id, expectedVersion: editing.version, records: [{ id: editing.id, values }] });
                }}
              >
                {list.fields.map(field => (
                  <label key={field.key} className="text-sm">
                    {field.label}
                    {field.type === 'select' || field.type === 'boolean'
                      ? (
                          <select name={field.key} className="block w-full rounded border bg-background p-2" value={String(editing.values[field.key] ?? '')} onChange={e => setEditing({ ...editing, values: { ...editing.values, [field.key]: e.target.value === '' ? null : field.type === 'boolean' ? e.target.value === 'true' : e.target.value } })}>
                            <option value="">Not set</option>
                            {(field.type === 'boolean' ? ['true', 'false'] : field.options!).map(option => <option key={option}>{option}</option>)}
                          </select>
                        )
                      : <Input name={field.key} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} step={field.type === 'number' ? 'any' : undefined} maxLength={10000} placeholder={field.type === 'reference' ? 'Linked record ID' : ''} value={String(editing.values[field.key] ?? '')} onChange={e => setEditing({ ...editing, values: { ...editing.values, [field.key]: e.target.value === '' ? null : field.type === 'number' ? Number(e.target.value) : e.target.value } })} />}
                    {field.type === 'reference' && <Link className="text-xs underline" href={`/dashboard/lists/${field.referenceListId}`}>Open linked List</Link>}
                  </label>
                ))}
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" disabled={busy}>Save record</Button>
                  <Button variant="outline" type="button" onClick={() => setEditing(undefined)}>Cancel</Button>
                </div>
              </form>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{list.title}</caption>
                <thead className="bg-muted">
                  <tr>
                    {list.fields.filter(f => !view || list.views.find(v => v.name === view)?.columns.includes(f.key)).map(f => <th className="p-3 font-medium whitespace-nowrap" key={f.key}>{f.label}</th>)}
                    <th className="p-3">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {detail.rows.map(row => (
                    <tr key={row.id}>
                      {list.fields.filter(f => !view || list.views.find(v => v.name === view)?.columns.includes(f.key)).map(f => <td key={f.key} className="max-w-80 min-w-32 p-3 break-words">{String(row.values[f.key] ?? '—')}</td>)}
                      <td className="p-3">
                        <Button variant="ghost" disabled={list.archived} onClick={() => setEditing({ id: row.id, version: list.version, values: row.values })}>Edit</Button>
                        <button
                          type="button"
                          className="block text-xs text-muted-foreground underline"
                          onClick={() => {
                            void navigator.clipboard.writeText(row.id).then(() => setNotice('Record ID copied')).catch(() => setError('Could not copy record ID'));
                          }}
                        >
                          Copy ID
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.rows.length === 0 && <p className="p-8 text-sm text-muted-foreground">No records match this view. Add a record or ask chat to populate this List.</p>}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}>Previous</Button>
              <span className="text-sm">
                {detail.total ? offset + 1 : 0}
                –
                {Math.min(offset + detail.rows.length, detail.total)}
                {' '}
                of
                {' '}
                {detail.total}
              </span>
              <Button variant="outline" disabled={offset + detail.rows.length >= detail.total} onClick={() => setOffset(v => v + 50)}>Next</Button>
            </div>
            {detail.canConfigure && !list.archived && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const key = fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                  void run({ action: 'configure', id, expectedVersion: list.version, addFields: [{ key, label: fieldName, type: fieldType }] });
                }}
              >
                <label htmlFor="list-field" className="text-sm">
                  New field
                  <Input id="list-field" value={fieldName} required maxLength={48} onChange={e => setFieldName(e.target.value)} />
                </label>
                <label className="text-sm">
                  Type
                  <select className="block rounded border bg-background p-2" value={fieldType} onChange={e => setFieldType(e.target.value as typeof fieldType)}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Yes / no</option>
                    <option value="date">Date</option>
                  </select>
                </label>
                <Button type="submit" variant="outline" disabled={busy}>Add field</Button>
              </form>
            )}
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">Recent history</summary>
              <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                {detail.history.map(h => (
                  <li key={h.id}>
                    Version
                    {h.version}
                    {' '}
                    ·
                    {new Date(h.createdAt).toLocaleString()}
                    {' '}
                    ·
                    {h.actorId}
                  </li>
                ))}
              </ol>
            </details>
          </>
        )}
      </div>
    </>
  );
}
