import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SignInMethodsList } from './SignInMethodsList';

/**
 * "Sign-in methods" on the profile page: every way this person can get in,
 * and unlinking one while another remains.
 */
const meta: Meta<typeof SignInMethodsList> = {
  title: 'Profile/Sign-in methods',
  component: SignInMethodsList,
  parameters: { layout: 'padded' },
  args: {
    onUnlink: async () => null,
    onLink: () => {},
  },
  decorators: [Story => <div className="max-w-xl"><Story /></div>],
};

export default meta;

type Story = StoryObj<typeof SignInMethodsList>;

/** A password and Google: either can go, since the other remains. */
export const PasswordAndGoogle: Story = {
  args: {
    methods: {
      email: 'dana@northwind.example',
      password: true,
      emailLink: true,
      providers: [
        { id: 'google', label: 'Google', linked: true, offered: true, unlinkProblem: null },
        { id: 'microsoft-entra-id', label: 'Microsoft', linked: false, offered: true, unlinkProblem: null },
      ],
    },
  },
};

/** Joined with Microsoft and nothing else: it cannot be unlinked until another way in is linked. */
export const MicrosoftOnly: Story = {
  args: {
    methods: {
      email: 'dana@northwind.example',
      password: false,
      emailLink: false,
      providers: [
        { id: 'google', label: 'Google', linked: false, offered: true, unlinkProblem: null },
        { id: 'microsoft-entra-id', label: 'Microsoft', linked: true, offered: true, unlinkProblem: 'This is your only way to sign in. Link another account first, then unlink this one.' },
      ],
    },
  },
};
