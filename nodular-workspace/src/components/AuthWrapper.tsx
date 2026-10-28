
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react'
import React from 'react'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

export function AuthWrapper({ children }: { children: React.ReactNode }) {
  if (!PUBLISHABLE_KEY) {
    // No Clerk - run open, for dumb agent dev
    return (
      <div>
        <div style={{ padding: '6px 12px', background: '#f59e0b', color: '#000', fontSize: 11, fontWeight: 700, textAlign: 'center' }}>
          Running without Clerk - set VITE_CLERK_PUBLISHABLE_KEY for auth. Free tier works open.
        </div>
        {children}
      </div>
    )
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 100, display: 'flex', gap: 8, alignItems: 'center' }}>
        <SignedOut>
          <SignInButton mode="modal">
            <button style={{ background: '#fff', color: '#000', border: 0, padding: '6px 12px', borderRadius: 20, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Sign In</button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </div>
      {children}
    </ClerkProvider>
  )
}
