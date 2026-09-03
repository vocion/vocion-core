import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

const mockPush = vi.fn();
const mockUsePathname = vi.fn(() => '/gtm/lead/88201');
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    usePathname: () => mockUsePathname(),
    useRouter: () => ({ push: mockPush }),
  };
});

const { AgentSurfaceButton } = await import('./AgentSurfaceButton');
const { AGENT_SURFACE_EVENT } = await import('./agentSurface');

beforeEach(() => {
  mockPush.mockReset();
  mockUsePathname.mockReset().mockReturnValue('/gtm/lead/88201');
});

describe('AgentSurfaceButton', () => {
  it('a mounted surface claims the click; the page never navigates', async () => {
    const claim = vi.fn((e: Event) => e.preventDefault());
    window.addEventListener(AGENT_SURFACE_EVENT, claim);
    try {
      await render(<AgentSurfaceButton />);

      await userEvent.click(page.getByRole('button', { name: 'Ask the agent' }));

      expect(claim).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(AGENT_SURFACE_EVENT, claim);
    }
  });

  it('falls back to the everything-scoped chat page when nothing claims it', async () => {
    await render(<AgentSurfaceButton />);

    await userEvent.click(page.getByRole('button', { name: 'Ask the agent' }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard/chat');
  });

  it('renders nothing on the full-page chat, which IS the conversation', async () => {
    mockUsePathname.mockReturnValue('/dashboard/chat');

    await render(<AgentSurfaceButton />);

    await expect.element(page.getByRole('button', { name: 'Ask the agent' })).not.toBeInTheDocument();
  });
});
