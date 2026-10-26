import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { UserMessage } from './UserMessage';

/**
 * An attached picture opens over the conversation (Jamie, 2026-10-26). The
 * picture is drawn here; every name is invented.
 */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#f4f4f5"/><rect x="60" y="60" width="1080" height="580" rx="16" fill="#fff" stroke="#e4e4e7"/><text x="100" y="140" font-family="sans-serif" font-size="36" fill="#18181b">Time off — Northwind team</text><g font-family="sans-serif" font-size="24" fill="#3f3f46"><text x="100" y="240">Avery Lane</text><text x="100" y="320">Sam Ortiz</text><text x="100" y="400">Kit Morgan</text></g><g font-family="sans-serif" font-size="20" font-weight="700"><rect x="880" y="212" width="200" height="40" rx="20" fill="#fef3c7"/><text x="905" y="239" fill="#92400e">48 HRS YTD</text><rect x="880" y="292" width="200" height="40" rx="20" fill="#fef3c7"/><text x="905" y="319" fill="#92400e">16 HRS YTD</text><rect x="880" y="372" width="200" height="40" rx="20" fill="#fef3c7"/><text x="912" y="399" fill="#92400e">8 HRS YTD</text></g></svg>`;
const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`;

const meta = {
  title: 'Chat/UserMessage/Image',
  component: UserMessage,
  args: {
    content: 'The badge on the right should read days, not hours.',
    attachments: [{ id: 5244, title: 'time-off.png', contentType: 'image/png', bytes: 182_000, url, kind: 'image' as const }],
  },
  decorators: [Story => <div className="mx-auto max-w-3xl p-6"><Story /></div>],
} satisfies Meta<typeof UserMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithImage: Story = {};
