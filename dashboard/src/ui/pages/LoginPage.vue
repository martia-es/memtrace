<script setup lang="ts">
// Auth.js no arranca el proveedor por GET con ?provider=: su página /api/auth/signin
// solo lista opciones. Para saltar directo hay que POSTear el csrfToken a
// /api/auth/signin/{provider} (lo mismo que hace su botón por dentro), así el usuario
// no ve una pantalla intermedia.
async function signIn(provider: "google" | "microsoft") {
  const res = await fetch("/api/auth/csrf");
  const { csrfToken } = await res.json();

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
    <div class="showcase">
      <div class="showcase-brand">
        <svg width="26" height="26" viewBox="0 0 22 22" aria-hidden="true">
          <rect x="1" y="3" width="12" height="4" rx="2" fill="#6FCF4A" />
          <rect x="6" y="9" width="15" height="4" rx="2" fill="#7A5AF8" />
          <rect x="3" y="15" width="9" height="4" rx="2" fill="#FF8A3D" />
        </svg>
        <span>memtrace</span>
      </div>

      <h1 class="showcase-title">Ve exactamente qué hace tu agente, paso a paso.</h1>
      <p class="showcase-sub">
        Trazas, spans y coste de cada conversación de tus agentes LLM, sin instrumentar nada a mano.
      </p>

      <div class="mockup mt-card">
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
            <div class="mockup-kpi-value ok">0.4%</div>
          </div>
        </div>
        <div class="mockup-trace">
          <span class="mt-pill ok">ok</span>
          <span class="mockup-trace-name">agent · search_flights → book_ticket</span>
          <span class="mockup-trace-meta">312ms</span>
        </div>
        <div class="mockup-trace">
          <span class="mt-pill warn">retry</span>
          <span class="mockup-trace-name">agent · call_llm(gpt-4)</span>
          <span class="mockup-trace-meta">1.1s</span>
        </div>
        <div class="mockup-trace">
          <span class="mt-pill ok">ok</span>
          <span class="mockup-trace-name">tool · fetch_weather</span>
          <span class="mockup-trace-meta">88ms</span>
        </div>
      </div>

      <ul class="showcase-features">
        <li>Sesiones y árboles de spans, no solo logs sueltos</li>
        <li>Latencia, tokens y coste por modelo y por herramienta</li>
        <li>LangChain, LangGraph y PydanticAI en Python o TypeScript</li>
      </ul>
    </div>

    <div class="login-card mt-card">
      <div class="brand mobile-only">
        <svg width="30" height="30" viewBox="0 0 22 22" aria-hidden="true">
          <rect x="1" y="3" width="12" height="4" rx="2" fill="#6FCF4A" />
          <rect x="6" y="9" width="15" height="4" rx="2" fill="#7A5AF8" />
          <rect x="3" y="15" width="9" height="4" rx="2" fill="#FF8A3D" />
        </svg>
        <span>memtrace</span>
      </div>
      <p class="hint">Inicia sesión para ver tus experimentos.</p>
      <button class="signin-btn primary" type="button" @click="signIn('google')">
        <svg class="provider-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.27h2.92c1.7-1.57 2.69-3.88 2.69-6.64z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.92-2.27c-.81.54-1.84.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.9v2.34C2.38 15.98 5.44 18 9 18z"/>
          <path fill="#FBBC05" d="M3.97 10.73a5.4 5.4 0 0 1 0-3.46V4.93H.9a8.99 8.99 0 0 0 0 8.14l3.07-2.34z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.44 0 2.38 2.02.9 4.93l3.07 2.34C4.68 5.16 6.66 3.58 9 3.58z"/>
        </svg>
        Iniciar sesión con Google
      </button>
      <button class="signin-btn" type="button" @click="signIn('microsoft')">
        <svg class="provider-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <rect x="1" y="1" width="7.5" height="7.5" fill="#F35325"/>
          <rect x="9.5" y="1" width="7.5" height="7.5" fill="#81BC06"/>
          <rect x="1" y="9.5" width="7.5" height="7.5" fill="#05A6F0"/>
          <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFBA08"/>
        </svg>
        Iniciar sesión con Microsoft
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 64px;
  height: 100vh;
  padding: 0 32px;
  background: var(--mt-bg);
}

.showcase {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 460px;
}
.showcase-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--mt-ink);
}
.showcase-title {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--mt-ink);
  margin: 4px 0 0;
}
.showcase-sub {
  font-size: 14px;
  color: var(--mt-muted);
  margin: 0;
  line-height: 1.5;
}
.showcase-features {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--mt-muted);
}
.showcase-features li {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.showcase-features li::before {
  content: "";
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mt-accent);
  transform: translateY(-2px);
}

.mockup {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mockup-row {
  display: flex;
  gap: 10px;
}
.mockup-kpi {
  flex: 1;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--mt-soft);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mockup-kpi-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mt-faint);
}
.mockup-kpi-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--mt-ink);
}
.mockup-kpi-value.ok {
  color: var(--mt-ok-ink);
}
.mockup-trace {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--mt-soft-2);
  font-size: 12px;
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
  color: var(--mt-faint);
  font-family: var(--mt-mono);
  font-size: 11px;
}

.login-card {
  flex-shrink: 0;
  padding: 40px 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 340px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--mt-ink);
}
.brand.mobile-only {
  display: none;
}
.hint {
  color: var(--mt-faint);
  font-size: 12px;
  margin: 4px 0 8px;
}
.signin-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 44px;
  padding: 0 24px;
  border: 0;
  border-radius: 22px;
  background: var(--mt-soft);
  color: var(--mt-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
  width: 100%;
}
.provider-icon {
  flex-shrink: 0;
}
.signin-btn:hover {
  background: var(--mt-soft-2);
}
.signin-btn.primary {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.signin-btn.primary:hover {
  opacity: 0.9;
  background: var(--mt-accent);
}

@media (max-width: 860px) {
  .showcase {
    display: none;
  }
  .login-container {
    padding: 0 16px;
  }
  .brand.mobile-only {
    display: flex;
  }
}
</style>
