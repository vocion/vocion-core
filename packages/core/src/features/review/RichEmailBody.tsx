'use client';

import type { Editor } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, ListOrdered, Unlink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isHtmlBody, textToParagraphs } from '@/libs/writing/emailBodyShape';
import { cn } from '@/utils/Helpers';

/**
 * The send's body, edited as it will arrive.
 *
 * A reviewer used to edit a `<textarea>` of plain text that became HTML at the
 * HubSpot write, so the one place a bold phrase or a link could have been put
 * was the one place they could not be put (Chris, 2026-09-20: *"the content in
 * the MQL content reviews should be a WYSIWYG editor and push full html to
 * hubspot"*).
 *
 * The schema is the point, not the toolbar. ProseMirror parses whatever is
 * loaded or pasted into the node types declared here and DISCARDS the rest, so
 * a body pasted out of Word arrives as paragraphs and bold rather than as a
 * screenful of Office markup — and the editor cannot compose something the
 * send cannot carry. It matches `EMAIL_TAGS` exactly; the server sanitizes to
 * the same list on the way in, because a schema in the browser is a
 * convenience and never the guarantee.
 *
 * It still reads as a message rather than as a form: no border until you touch
 * it, the toolbar only while it has focus, and the same soft fill the subject
 * line uses (`docs/design/patterns.md` § B-034b — soft fills, no chrome
 * borders).
 */

const FIELD = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm leading-relaxed transition outline-none hover:bg-[var(--surface-hover,var(--muted))] focus-within:bg-[var(--surface-soft,var(--muted))]';

/** Exactly the marks `EMAIL_TAGS` allows, and nothing a send cannot carry. */
const EXTENSIONS = [
  StarterKit.configure({
    // An email is paragraphs, emphasis and lists. A heading, a code block, a
    // blockquote or a rule would all have to be stripped at the boundary, and
    // offering a control that silently loses its formatting is worse than not
    // offering it.
    heading: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
    code: false,
    link: false,
  }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    // The schemes a recipient can actually open, matching the server's
    // allowlist. `javascript:` is refused in both places.
    protocols: ['http', 'https', 'mailto', 'tel'],
  }),
];

function ToolButton(props: { on?: boolean; label: string; onClick: () => void; icon: typeof Bold; disabled?: boolean }) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.on}
      title={props.label}
      disabled={props.disabled}
      // `onMouseDown` rather than `onClick`: a click steals focus from the
      // editor first, and the command would then apply to no selection.
      onMouseDown={(e) => {
        e.preventDefault();
        props.onClick();
      }}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40',
        props.on && 'bg-surface-hover text-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [, force] = useState(0);
  // The marks under the cursor change with every selection, and the editor
  // reports that through its own event rather than through React state.
  // `selectionUpdate` and `update` only: `transaction` also fires for the
  // editor's own bookkeeping (`setEditable` dispatches one), and redrawing on
  // that put this component in a render loop.
  useEffect(() => {
    const rerender = () => force(n => n + 1);
    editor.on('selectionUpdate', rerender);
    editor.on('update', rerender);
    return () => {
      editor.off('selectionUpdate', rerender);
      editor.off('update', rerender);
    };
  }, [editor]);

  const linked = editor.isActive('link');
  return (
    <div className="flex items-center gap-0.5 pb-1" data-testid="rich-toolbar" role="toolbar" aria-label="Formatting">
      <ToolButton icon={Bold} label="Bold" on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolButton icon={Italic} label="Italic" on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolButton icon={List} label="Bulleted list" on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolButton icon={ListOrdered} label="Numbered list" on={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolButton
        icon={linked ? Unlink : Link2}
        label={linked ? 'Remove link' : 'Add link'}
        on={linked}
        onClick={() => {
          if (linked) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          // eslint-disable-next-line no-alert
          const href = window.prompt('Link to');
          if (href) {
            editor.chain().focus().setLink({ href }).run();
          }
        }}
      />
    </div>
  );
}

/**
 * @param props - The body, the editor's handler, and whether it is read-only.
 * @param props.value - The stored body: prose from an agent, HTML from a reviewer.
 * @param props.onChange - Called with the body as HTML. Absent for read-only.
 * @param props.disabled - Held while busy or regenerating.
 * @param props.label - The accessible name; there is no visible label.
 */
export function RichEmailBody({ value, onChange, disabled, label }: {
  value: string;
  onChange?: (html: string) => void;
  disabled?: boolean;
  label: string;
}) {
  // What the editor is told to hold, which is always HTML: a plain-text draft
  // opens as paragraphs rather than as one run-on line.
  const asHtml = isHtmlBody(value) ? value : textToParagraphs(value);
  // The editor owns the document while it has focus; `value` coming back
  // identical on every keystroke must not reset the cursor to the start.
  const lastEmitted = useRef<string | null>(null);
  // What the editor itself produced from the body we handed it. Anything
  // equal to this is a RE-ENCODING, not an edit: ProseMirror normalises on
  // load, and propagating that as a change wrote an edit nobody made — which
  // changed the hash a check is drawn from and silently took an approval back
  // the moment a pane mounted.
  const baseline = useRef<string | null>(null);
  // The handler through a ref, so the editor's own callbacks are STABLE. The
  // caller passes an inline arrow, which is a new function on every render,
  // and an effect that depended on it re-ran `setEditable` every time — a
  // render loop, and the first thing that broke when this landed.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const canEdit = !disabled && Boolean(onChange);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: asHtml,
    editable: canEdit,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': label,
        'role': 'textbox',
        'aria-multiline': 'true',
        'class': 'min-h-24 outline-none [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-2',
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.isEmpty ? '' : e.getHTML();
      if (html === baseline.current) {
        return;
      }
      lastEmitted.current = html;
      onChangeRef.current?.(html);
    },
  });

  // A body replaced from outside — a regeneration landing, a tab remounting,
  // an approved revision restored — has to reach the editor. A body it just
  // emitted itself must not: setting content would collapse the selection.
  useEffect(() => {
    if (!editor) {
      return;
    }
    if (asHtml === lastEmitted.current) {
      // Our own emit coming back. The baseline moves with it, so the next
      // keystroke is measured against what is now stored.
      baseline.current = editor.getHTML();
      return;
    }
    if (asHtml !== editor.getHTML()) {
      editor.commands.setContent(asHtml, { emitUpdate: false });
    }
    baseline.current = editor.getHTML();
  }, [editor, asHtml]);

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  if (!editor) {
    return null;
  }

  return (
    <div data-testid="rich-email-body" className={cn(FIELD, disabled && 'opacity-60')}>
      {canEdit && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
