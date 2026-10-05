<script setup lang="ts">
import { fetchCsrfToken } from "@/adapters/outbound/browser-auth";

// Auth.js doesn't start the provider on a GET with ?provider=: its /api/auth/signin page
// only lists options. To skip straight to it, the csrfToken must be POSTed to
// /api/auth/signin/{provider} (the same thing its button does internally), so the user
// never sees an intermediate screen.
async function signIn(provider: "google" | "microsoft") {
  const csrfToken = await fetchCsrfToken();

  const form = document.createElement("form");
  form.method = "POST";
  form.action = `/api/auth/signin/${provider}`;
  form.style.display = "none";

  const fields = { csrfToken, callbackUrl: window.location.origin };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}
</script>

<template>
  <div class="login-container">
    <div class="showcase-panel">
      <div class="showcase">
        <div class="showcase-brand">
          <svg width="26" height="26" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="12" height="4.5" rx="2.25" fill="var(--mt-brand)" />
            <rect x="6" y="9" width="15" height="4.5" rx="2.25" fill="var(--mt-highlight)" />
            <rect x="3" y="15" width="9" height="4.5" rx="2.25" fill="var(--mt-brand)" opacity="0.5" />
          </svg>
          <span>MemTrace</span>
        </div>

        <h1 class="showcase-title">Understand what your agent does, with peace of mind.</h1>
        <p class="showcase-sub">
          Traces, spans, and cost for every conversation, with no manual instrumentation.
        </p>

        <div class="mockup" aria-hidden="true">
          <div class="mockup-row">
            <div class="mockup-kpi">
              <div class="mockup-kpi-label">TRACES</div>
              <div class="mockup-kpi-value">1,204</div>
            </div>
            <div class="mockup-kpi">
              <div class="mockup-kpi-label">LATENCY P95</div>
              <div class="mockup-kpi-value">840ms</div>
            </div>
            <div class="mockup-kpi">
              <div class="mockup-kpi-label">ERRORS</div>
              <div class="mockup-kpi-value">0.4%</div>
            </div>
          </div>
          <div class="mockup-trace">
            <span class="mockup-pill ok">ok</span>
            <span class="mockup-trace-name">agent · search_flights → book_ticket</span>
            <span class="mockup-trace-meta">312ms</span>
          </div>
          <div class="mockup-trace">
            <span class="mockup-pill warn">retry</span>
            <span class="mockup-trace-name">agent · call_llm(gpt-4)</span>
            <span class="mockup-trace-meta">1.1s</span>
          </div>
          <div class="mockup-trace">
            <span class="mockup-pill ok">ok</span>
            <span class="mockup-trace-name">tool · fetch_weather</span>
            <span class="mockup-trace-meta">88ms</span>
          </div>
        </div>

        <ul class="showcase-features">
          <li>Sessions and span trees, not just loose logs</li>
          <li>Latency, tokens, and cost per model and per tool</li>
          <li>LangChain, LangGraph, and PydanticAI in Python or TypeScript</li>
        </ul>
      </div>
    </div>

    <div class="login-panel">
      <div class="login-card">
        <div class="brand mobile-only">
          <svg width="30" height="30" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="12" height="4.5" rx="2.25" fill="var(--mt-brand)" />
            <rect x="6" y="9" width="15" height="4.5" rx="2.25" fill="var(--mt-highlight)" />
            <rect x="3" y="15" width="9" height="4.5" rx="2.25" fill="var(--mt-brand)" opacity="0.5" />
          </svg>
          <span>MemTrace</span>
        </div>
        <h2 class="welcome">Welcome back</h2>
        <p class="hint">Sign in to pick up where you left off.</p>
        <button class="signin-btn primary" type="button" @click="signIn('google')">
          <span class="provider-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.27h2.92c1.7-1.57 2.69-3.88 2.69-6.64z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.92-2.27c-.81.54-1.84.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.9v2.34C2.38 15.98 5.44 18 9 18z"/>
              <path fill="#FBBC05" d="M3.97 10.73a5.4 5.4 0 0 1 0-3.46V4.93H.9a8.99 8.99 0 0 0 0 8.14l3.07-2.34z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.44 0 2.38 2.02.9 4.93l3.07 2.34C4.68 5.16 6.66 3.58 9 3.58z"/>
            </svg>
          </span>
          Sign in with Google
        </button>
        <button class="signin-btn" type="button" @click="signIn('microsoft')">
          <span class="provider-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <rect x="1" y="1" width="7.5" height="7.5" fill="#F35325"/>
              <rect x="9.5" y="1" width="7.5" height="7.5" fill="#81BC06"/>
              <rect x="1" y="9.5" width="7.5" height="7.5" fill="#05A6F0"/>
              <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFBA08"/>
            </svg>
          </span>
          Sign in with Microsoft
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  min-height: 100vh;
  background: var(--mt-bg);
}

/* Left panel: flat brand surface (no gradients, glows or shadows), same tokens in light and dark. */
.showcase-panel {
  flex: 1.1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  background: var(--mt-bg);
  border-right: 1px solid var(--mt-line);
}
.showcase {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 480px;
}
.showcase-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--mt-ink);
}
.showcase-title {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
  margin: 4px 0 0;
  color: var(--mt-ink);
}
.showcase-sub {
  font-size: 15px;
  font-weight: 500;
  color: var(--mt-muted);
  margin: 0;
  line-height: 1.55;
  max-width: 420px;
}
.showcase-features {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--mt-muted);
}
.showcase-features li {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.showcase-features li::before {
  content: "";
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mt-highlight);
  transform: translateY(-1px);
}

.mockup {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
}
.mockup-row {
  display: flex;
  gap: 10px;
}
.mockup-kpi {
  flex: 1;
  padding: 10px 12px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mockup-kpi-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mt-muted);
}
.mockup-kpi-value {
  font-family: var(--mt-mono);
  font-size: 16px;
  font-weight: 700;
  color: var(--mt-ink);
}
.mockup-trace {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 10px;
  border-top: 1px solid var(--mt-line-2);
  font-size: 12.5px;
}
.mockup-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--mt-radius-xs);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.mockup-pill.ok {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.mockup-pill.warn {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.mockup-trace-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mt-mono);
  color: var(--mt-ink);
}
.mockup-trace-meta {
  flex-shrink: 0;
  color: var(--mt-muted);
  font-family: var(--mt-mono);
  font-size: 11px;
}

.login-panel {
  flex: 1;
  min-width: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mt-card);
}
.login-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  width: 340px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--mt-ink);
  align-self: center;
}
.brand.mobile-only {
  display: none;
}
.welcome {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--mt-ink);
  margin: 0;
}
.hint {
  color: var(--mt-muted);
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 12px;
}
.signin-btn {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  height: 46px;
  padding: 0 16px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  width: 100%;
}
.provider-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--mt-radius-xs);
  background: #ffffff;
}
.signin-btn:hover {
  border-color: var(--mt-accent);
  background: var(--mt-accent-tint);
}
.signin-btn.primary {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  border-color: var(--mt-accent);
}
.signin-btn.primary:hover {
  background: var(--mt-accent-text);
  border-color: var(--mt-accent-text);
}
:global(body.body--dark) .signin-btn.primary:hover {
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
}

@media (max-width: 900px) {
  .showcase-panel {
    display: none;
  }
  .login-panel {
    min-width: 0;
    width: 100%;
    padding: 0 24px;
  }
  .brand.mobile-only {
    display: flex;
    margin-bottom: 8px;
  }
}
</style>
