// Auth UI — magic link sign-in via Supabase.
// Renders sign-in button or signed-in email + sign-out, and emits an
// 'kma:auth-changed' event when state changes (matrix.js listens).

import { getSupabaseClient, signInWithMagicLink, signOut, getCurrentUser } from './data-loader.js';

document.addEventListener('DOMContentLoaded', async () => {
  await renderAuthState();

  // Listen for auth state changes (e.g., after magic link redirect)
  const client = await getSupabaseClient();
  if (client) {
    client.auth.onAuthStateChange(async (_event, _session) => {
      await renderAuthState();
      document.dispatchEvent(new CustomEvent('kma:auth-changed'));
    });
  }

  document.body.addEventListener('click', async (e) => {
    if (e.target.id === 'auth-signin-btn') {
      const email = prompt('Sign in with magic link — type your email:');
      if (!email) return;
      try {
        await signInWithMagicLink(email.trim());
        alert(`Magic link sent to ${email}. Check your inbox and click the link to sign in.`);
      } catch (err) {
        alert(`Sign-in failed: ${err.message}`);
      }
    }
    if (e.target.id === 'auth-signout-btn') {
      await signOut();
      await renderAuthState();
      document.dispatchEvent(new CustomEvent('kma:auth-changed'));
    }
  });
});

async function renderAuthState() {
  const wrap = document.getElementById('auth-status');
  if (!wrap) return;
  const user = await getCurrentUser();
  if (user) {
    wrap.innerHTML = `
      <span class="auth-email" title="${user.email}">${user.email.split('@')[0]} ✎</span>
      <button id="auth-signout-btn" class="auth-btn">Sign out</button>
    `;
    document.body.classList.add('auth-signed-in');
  } else {
    wrap.innerHTML = `<button id="auth-signin-btn" class="auth-btn">Sign in to edit</button>`;
    document.body.classList.remove('auth-signed-in');
  }
}
