'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { client } from '@/libs/Orpc';

type Status = {
  ok: boolean;
  message: string;
};

function StatusLine({ status }: { status: Status | null }) {
  if (!status) {
    return null;
  }
  return (
    <p className={`text-sm ${status.ok ? 'text-emerald-600' : 'text-destructive'}`}>
      {status.message}
    </p>
  );
}

export function ProfilePanel() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameStatus, setNameStatus] = useState<Status | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<Status | null>(null);

  const refresh = useCallback(async () => {
    try {
      const profile = await client.profile.get();
      setName(profile.name ?? '');
      setEmail(profile.email);
      setLoadError(null);
    } catch {
      setLoadError('Could not load your profile.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // False positive: every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    setNameStatus(null);
    try {
      await client.profile.updateName({ name });
      setNameStatus({ ok: true, message: 'Profile saved.' });
    } catch (err) {
      setNameStatus({
        ok: false,
        message: err instanceof Error && err.message ? err.message : 'Could not save profile.',
      });
    }
    setSavingName(false);
  };

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatus(null);
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ ok: false, message: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordStatus({ ok: false, message: 'New password must be at least 8 characters.' });
      return;
    }
    setChangingPassword(true);
    try {
      await client.profile.changePassword({ currentPassword, newPassword });
      setPasswordStatus({ ok: true, message: 'Password changed.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordStatus({
        ok: false,
        message: err instanceof Error && err.message ? err.message : 'Could not change password.',
      });
    }
    setChangingPassword(false);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading profile…</p>;
  }

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  return (
    <div className="space-y-6">
      <DashboardSection
        title="Profile"
        description="Your display name is shown to teammates across the workspace."
      >
        <form onSubmit={onSaveName} className="max-w-md space-y-3">
          <div className="space-y-1">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" type="email" value={email} readOnly disabled />
            <p className="text-xs text-muted-foreground">
              Your email is your sign-in identity and cannot be changed here.
            </p>
          </div>
          <StatusLine status={nameStatus} />
          <Button type="submit" disabled={savingName}>
            {savingName ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </DashboardSection>

      <DashboardSection
        title="Change password"
        description="Use at least 8 characters. You'll stay signed in on this device."
      >
        <form onSubmit={onChangePassword} className="max-w-md space-y-3">
          <div className="space-y-1">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <StatusLine status={passwordStatus} />
          <Button type="submit" disabled={changingPassword}>
            {changingPassword ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </DashboardSection>
    </div>
  );
}
